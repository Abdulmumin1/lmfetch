/**
 * Main context builder - orchestrates the entire pipeline
 */
import { createSource, type SourceFile, type SourceOptions } from "./sources";
import { CodeChunker, type Chunk, type ScoredChunk } from "./chunkers";
import { HybridRanker } from "./rankers";
import {
  buildDependencyGraph,
  calculateCentrality,
  calculateImportance,
  combineScores,
} from "./analyzers";
import { getCache } from "./cache";
import { countTokens, parseBudget } from "./tokens";
import { chunkFilesParallel, tokenCache } from "./chunking-parallel";

export interface BuilderOptions {
  /** Local path or GitHub URL */
  path: string;
  /** Natural language query */
  query: string;
  /** Token budget (e.g., "50k", "100k", "1m") */
  budget?: string | number;
  /** Glob patterns to include */
  includes?: string[];
  /** Glob patterns to exclude */
  excludes?: string[];
  /** Skip semantic ranking (faster) */
  fast?: boolean;
  /** Process large files */
  forceLarge?: boolean;
  /** Progress callback */
  onProgress?: (message: string) => void;
}

export interface BuildResult {
  /** Formatted context string */
  context: string;
  /** Chunks included in context */
  chunks: ScoredChunk[];
  /** Total tokens in context */
  tokens: number;
  /** Number of files processed */
  filesProcessed: number;
  /** Number of chunks created */
  chunksCreated: number;
}

export class ContextBuilder {
  private options: BuilderOptions;
  private budget: number;
  private progress: (message: string) => void;

  constructor(options: BuilderOptions) {
    this.options = options;
    this.budget =
      typeof options.budget === "number"
        ? options.budget
        : parseBudget(options.budget || "50k");
    this.progress = options.onProgress || (() => {});
  }

  /**
   * Build context from the source
   */
  async build(): Promise<BuildResult> {
    const cache = await getCache();

    // Step 1: Discover files
    this.progress("Discovering files...");
    const source = createSource(this.options.path, {
      includes: this.options.includes,
      excludes: this.options.excludes,
      forceLarge: this.options.forceLarge,
    });

    const files: SourceFile[] = [];
    for await (const file of source.discover()) {
      files.push(file);
    }

    this.progress(`Found ${files.length} files`);

    if (files.length === 0) {
      return {
        context: "No files found matching the criteria.",
        chunks: [],
        tokens: 0,
        filesProcessed: 0,
        chunksCreated: 0,
      };
    }

    // Step 2: Build dependency graph and calculate importance (parallel)
    this.progress("Analyzing dependencies...");

    const [depGraph, importance] = await Promise.all([
      Promise.resolve(buildDependencyGraph(files, source.rootPath)),
      Promise.resolve(calculateImportance(files)),
    ]);

    const centrality = calculateCentrality(depGraph);
    const combinedImportance = combineScores(importance, centrality);

    // Step 3: Chunk all files in parallel with caching
    this.progress("Chunking files...");
    const allChunks: Chunk[] = [];

    // Separate cached and uncached files
    const cachedFiles: SourceFile[] = [];
    const uncachedFiles: SourceFile[] = [];

    for (const file of files) {
      if (cache.hasCachedChunks(file.path, file.mtime)) {
        cachedFiles.push(file);
      } else {
        uncachedFiles.push(file);
      }
    }

    // Load cached chunks (fast, sequential is fine)
    for (const file of cachedFiles) {
      const cachedChunks = cache.getChunks(file.path);
      for (const cached of cachedChunks) {
        allChunks.push({
          id: `${file.path}:${cached.start_line}`,
          filePath: file.path,
          relativePath: file.relativePath,
          content: cached.content,
          startLine: cached.start_line,
          endLine: cached.end_line,
          type: cached.chunk_type as Chunk["type"],
          name: cached.name || undefined,
          language: file.language,
          tokens: tokenCache.count(cached.content),
        });
      }
    }

    // Chunk uncached files in parallel
    if (uncachedFiles.length > 0) {
      const batchSize = Math.min(20, Math.max(5, Math.ceil(uncachedFiles.length / 10)));
      const newChunks = await chunkFilesParallel(uncachedFiles, batchSize);
      allChunks.push(...newChunks);

      // Cache new chunks in batches (async, don't wait)
      this.cacheChunksAsync(cache, uncachedFiles, newChunks);
    }

    this.progress(`Created ${allChunks.length} chunks`);

    // Step 4: Rank chunks
    this.progress("Ranking chunks...");
    const ranker = new HybridRanker(combinedImportance, {
      fast: this.options.fast,
      onProgress: this.progress,
    });

    const rankedChunks = await ranker.rank(allChunks, this.options.query);

    // Step 5: Select chunks within budget
    this.progress("Selecting best chunks...");
    const selectedChunks = this.selectWithinBudget(rankedChunks);

    // Step 6: Format context
    this.progress("Formatting context...");
    const context = this.formatContext(selectedChunks);
    const tokens = tokenCache.count(context);

    // Clear token cache to free memory
    tokenCache.clear();

    return {
      context,
      chunks: selectedChunks,
      tokens,
      filesProcessed: files.length,
      chunksCreated: allChunks.length,
    };
  }

  /**
   * Cache chunks asynchronously (fire and forget)
   */
  private async cacheChunksAsync(
    cache: Awaited<ReturnType<typeof getCache>>,
    files: SourceFile[],
    chunks: Chunk[]
  ): Promise<void> {
    // Group chunks by file
    const chunksByFile = new Map<string, Chunk[]>();
    for (const chunk of chunks) {
      const fileChunks = chunksByFile.get(chunk.filePath) || [];
      fileChunks.push(chunk);
      chunksByFile.set(chunk.filePath, fileChunks);
    }

    // Cache files and their chunks
    for (const file of files) {
      const fileChunks = chunksByFile.get(file.path);
      if (fileChunks) {
        cache.setFile(file.path, file.content, file.mtime, file.language);
        cache.setChunks(file.path, fileChunks);
      }
    }
  }

  /**
   * Select chunks that fit within the token budget
   */
  private selectWithinBudget(chunks: ScoredChunk[]): ScoredChunk[] {
    const selected: ScoredChunk[] = [];
    let currentTokens = 0;

    // Reserve some tokens for formatting overhead
    const effectiveBudget = Math.floor(this.budget * 0.95);

    for (const chunk of chunks) {
      // Estimate formatting overhead per chunk
      const overhead = 50; // File path, line numbers, etc.
      const chunkCost = chunk.tokens + overhead;

      if (currentTokens + chunkCost <= effectiveBudget) {
        selected.push(chunk);
        currentTokens += chunkCost;
      }

      // Stop if we've used most of the budget
      if (currentTokens >= effectiveBudget * 0.98) {
        break;
      }
    }

    return selected;
  }

  /**
   * Format selected chunks into a context string
   */
  private formatContext(chunks: ScoredChunk[]): string {
    if (chunks.length === 0) {
      return "No relevant code found for the query.";
    }

    // Group chunks by file
    const byFile = new Map<string, ScoredChunk[]>();
    for (const chunk of chunks) {
      const existing = byFile.get(chunk.relativePath) || [];
      existing.push(chunk);
      byFile.set(chunk.relativePath, existing);
    }

    // Sort chunks within each file by line number
    for (const [_, fileChunks] of byFile) {
      fileChunks.sort((a, b) => a.startLine - b.startLine);
    }

    // Format output
    const parts: string[] = [];

    for (const [filePath, fileChunks] of byFile) {
      parts.push(`## ${filePath}\n`);

      for (const chunk of fileChunks) {
        const lineInfo =
          chunk.startLine === chunk.endLine
            ? `Line ${chunk.startLine}`
            : `Lines ${chunk.startLine}-${chunk.endLine}`;

        const nameInfo = chunk.name ? ` (${chunk.type}: ${chunk.name})` : "";

        parts.push(`### ${lineInfo}${nameInfo}\n`);
        parts.push("```" + chunk.language);
        parts.push(chunk.content);
        parts.push("```\n");
      }
    }

    return parts.join("\n");
  }
}
