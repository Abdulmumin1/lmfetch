/**
 * Optimized parallel chunking utilities
 */
import { countTokens } from "./tokens";
import type { Chunk } from "./chunkers/types";
import type { SourceFile } from "./sources/types";

interface ChunkTask {
  file: SourceFile;
  index: number;
}

interface ChunkResult {
  index: number;
  chunks: Chunk[];
}

/**
 * Chunk files in parallel batches for better performance
 */
export async function chunkFilesParallel(
  files: SourceFile[],
  batchSize: number = 10
): Promise<Chunk[]> {
  const { CodeChunker } = await import("./chunkers/code");
  const chunker = new CodeChunker();

  const allChunks: Chunk[] = [];

  // Process files in batches
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);

    // Process batch in parallel
    const batchChunks = await Promise.all(
      batch.map(async (file) => {
        return chunker.chunk(
          file.content,
          file.path,
          file.relativePath,
          file.language
        );
      })
    );

    // Flatten and add to results
    for (const chunks of batchChunks) {
      allChunks.push(...chunks);
    }
  }

  return allChunks;
}

/**
 * Fast token counting cache
 */
class TokenCache {
  private cache = new Map<string, number>();

  count(text: string): number {
    const hash = this.hash(text);

    if (this.cache.has(hash)) {
      return this.cache.get(hash)!;
    }

    const tokens = countTokens(text);
    this.cache.set(hash, tokens);
    return tokens;
  }

  private hash(text: string): string {
    // Fast hash for short strings
    if (text.length < 1000) {
      return text.slice(0, 100) + text.length;
    }
    // For longer strings, sample
    return text.slice(0, 100) + text.slice(-100) + text.length;
  }

  clear() {
    this.cache.clear();
  }
}

export const tokenCache = new TokenCache();
