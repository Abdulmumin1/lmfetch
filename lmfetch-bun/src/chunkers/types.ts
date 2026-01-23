/**
 * Chunk type definitions
 */

export type ChunkType =
  | "function"
  | "class"
  | "method"
  | "interface"
  | "type"
  | "enum"
  | "module"
  | "section"
  | "constant"
  | "variable";

export interface Chunk {
  /** Unique identifier for the chunk */
  id: string;
  /** Absolute path to the source file */
  filePath: string;
  /** Relative path from the source root */
  relativePath: string;
  /** The chunk content */
  content: string;
  /** Starting line number (1-indexed) */
  startLine: number;
  /** Ending line number (1-indexed) */
  endLine: number;
  /** Type of code construct */
  type: ChunkType;
  /** Name of the function/class/etc if applicable */
  name?: string;
  /** Programming language */
  language: string;
  /** Token count */
  tokens: number;
}

export interface ScoredChunk extends Chunk {
  /** Relevance score (0-1) */
  score: number;
}

export interface Chunker {
  /** Split a file into chunks */
  chunk(
    content: string,
    filePath: string,
    relativePath: string,
    language: string
  ): Chunk[];
}
