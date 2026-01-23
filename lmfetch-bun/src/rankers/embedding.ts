/**
 * Semantic embedding ranker using AI SDK - OPTIMIZED
 */
import { embedMany } from "ai";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { join } from "path";
import { mkdir, readFile, writeFile } from "fs/promises";
import { getCacheDir, cosineSimilarity, retry } from "../utils";
import { hashContent } from "../utils";
import type { Chunk, ScoredChunk } from "../chunkers/types";
import type { Ranker } from "./types";

const EMBEDDINGS_DIR = join(getCacheDir(), "embeddings");
const BATCH_SIZE = 100; // Increased from 20 for better performance
const MAX_EMBED_CHARS = 8000;
const EMBED_TIMEOUT = 30000; // 30 second timeout per batch

// Default to Google's text-embedding-004
const DEFAULT_PROVIDER = "google";

export class EmbeddingRanker implements Ranker {
  private cache: Map<string, number[]> = new Map();
  private provider: "google" | "openai";

  constructor(provider: "google" | "openai" = DEFAULT_PROVIDER) {
    this.provider = provider;
  }

  /**
   * Get the embedding model based on provider
   */
  private getModel() {
    if (this.provider === "openai") {
      return openai.textEmbeddingModel("text-embedding-3-small");
    }
    return google.textEmbeddingModel("text-embedding-004");
  }

  /**
   * Create context-enriched text for embedding
   */
  private enrichWithContext(chunk: Chunk): string {
    const parts: string[] = [];

    // Add file path context
    parts.push(`File: ${chunk.relativePath}`);

    // Add name if available
    if (chunk.name) {
      parts.push(`${chunk.type}: ${chunk.name}`);
    }

    // Add content (truncated)
    const content = chunk.content.slice(0, MAX_EMBED_CHARS);
    parts.push(content);

    return parts.join("\n");
  }

  /**
   * Load embedding from disk cache
   */
  private async loadFromDisk(key: string): Promise<number[] | null> {
    try {
      const path = join(EMBEDDINGS_DIR, `${key}.json`);
      const content = await readFile(path, "utf-8");
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * Save embedding to disk cache (async, fire and forget)
   */
  private saveToDisk(key: string, embedding: number[]): void {
    // Fire and forget - don't await
    mkdir(EMBEDDINGS_DIR, { recursive: true })
      .then(() => {
        const path = join(EMBEDDINGS_DIR, `${key}.json`);
        return writeFile(path, JSON.stringify(embedding));
      })
      .catch(() => {
        // Ignore cache write errors
      });
  }

  /**
   * Embed multiple texts with aggressive caching and batching
   */
  private async embedTexts(texts: string[]): Promise<number[][]> {
    const results: (number[] | null)[] = new Array(texts.length).fill(null);
    const toEmbed: { index: number; text: string; key: string }[] = [];

    // Check cache first (memory + disk in parallel)
    await Promise.all(
      texts.map(async (text, i) => {
        const key = hashContent(text);

        // Check memory cache
        if (this.cache.has(key)) {
          results[i] = this.cache.get(key)!;
          return;
        }

        // Check disk cache
        const cached = await this.loadFromDisk(key);
        if (cached) {
          this.cache.set(key, cached);
          results[i] = cached;
          return;
        }

        toEmbed.push({ index: i, text, key });
      })
    );

    // Embed uncached texts in large batches
    if (toEmbed.length > 0) {
      // Split into batches
      for (let i = 0; i < toEmbed.length; i += BATCH_SIZE) {
        const batchItems = toEmbed.slice(i, i + BATCH_SIZE);
        const batchTexts = batchItems.map((item) => item.text);

        try {
          // Embed with timeout
          const embeddings = await Promise.race([
            this.embedBatch(batchTexts),
            new Promise<number[][]>((_, reject) =>
              setTimeout(() => reject(new Error("Embedding timeout")), EMBED_TIMEOUT)
            ),
          ]);

          // Store results
          for (let j = 0; j < batchItems.length; j++) {
            const { index, key } = batchItems[j];
            const embedding = embeddings[j];

            // Cache in memory
            this.cache.set(key, embedding);
            // Save to disk async
            this.saveToDisk(key, embedding);

            results[index] = embedding;
          }
        } catch (error) {
          console.error(`Embedding batch failed:`, error);
          // Fill failed embeddings with zeros
          for (const { index } of batchItems) {
            results[index] = new Array(768).fill(0); // Standard embedding size
          }
        }
      }
    }

    return results as number[][];
  }

  /**
   * Embed a single batch with the API
   */
  private async embedBatch(texts: string[]): Promise<number[][]> {
    const { embeddings } = await retry(
      async () => {
        return await embedMany({
          model: this.getModel(),
          values: texts,
        });
      },
      { retries: 2, delay: 500, backoff: 1.5 }
    );

    return embeddings;
  }

  /**
   * Embed a single query
   */
  async embedQuery(query: string): Promise<number[]> {
    const key = hashContent(query);

    // Check cache
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    // Check disk cache
    const cached = await this.loadFromDisk(key);
    if (cached) {
      this.cache.set(key, cached);
      return cached;
    }

    // Embed the query
    const [embedding] = await this.embedBatch([query]);
    this.cache.set(key, embedding);
    this.saveToDisk(key, embedding);

    return embedding;
  }

  async rank(chunks: Chunk[], query: string): Promise<ScoredChunk[]> {
    // Embed query
    const queryEmbedding = await this.embedQuery(query);

    // Embed all chunks
    const texts = chunks.map((c) => this.enrichWithContext(c));
    const embeddings = await this.embedTexts(texts);

    // Calculate similarity scores
    const scored = chunks.map((chunk, i) => ({
      ...chunk,
      score: cosineSimilarity(queryEmbedding, embeddings[i]),
    }));

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    return scored;
  }
}
