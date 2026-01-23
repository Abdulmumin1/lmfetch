/**
 * Ranker type definitions
 */
import type { Chunk, ScoredChunk } from "../chunkers/types";

export interface Ranker {
  /** Rank chunks by relevance to query */
  rank(chunks: Chunk[], query: string): Promise<ScoredChunk[]>;
}

export interface RankerOptions {
  /** Use fast mode (skip embeddings) */
  fast?: boolean;
  /** Progress callback */
  onProgress?: (message: string) => void;
}

export type { ScoredChunk };
