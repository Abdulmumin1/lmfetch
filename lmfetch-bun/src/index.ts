/**
 * lmfetch - Lightning-fast code context fetcher for LLMs
 * Programmatic API
 */

export { ContextBuilder } from "./builder";
export type { BuilderOptions, BuildResult } from "./builder";

export { createSource } from "./sources";
export type { SourceFile, SourceOptions } from "./sources/types";

export { CodeChunker } from "./chunkers";
export type { Chunk, ScoredChunk } from "./chunkers/types";

export { KeywordRanker, EmbeddingRanker, HybridRanker } from "./rankers";
export type { Ranker, RankerOptions } from "./rankers/types";

export { queryWithContext } from "./llm";

export { countTokens, parseBudget } from "./tokens";

export { getCache } from "./cache";
export { buildContextWithSearch } from "./context-search";

export {
  findFiles,
  readCode,
  renderFindFilesResults,
  renderReadCodeResult,
  renderSearchResults,
  searchCode,
} from "./search";
export type {
  FindFileResult,
  FindFilesOptions,
  FindFilesResponse,
  ReadCodeLine,
  ReadCodeOptions,
  ReadCodeResponse,
  SearchCodeOptions,
  SearchFilePriority,
  SearchFileResult,
  SearchMatch,
  SearchNextStep,
  SearchProviderMode,
  SearchReason,
  SearchReasonSignal,
  SearchResponse,
  SearchSummary,
} from "./search";

/**
 * Quick helper to fetch context for a query
 */
export async function fetchContext(
  path: string,
  query: string,
  options?: {
    budget?: string | number;
    includes?: string[];
    excludes?: string[];
    semantic?: boolean;  // Use semantic ranking instead of keyword-only
    forceLarge?: boolean;
    onProgress?: (message: string) => void;
  }
) {
  const { buildContextWithSearch } = await import("./context-search");

  const result = await buildContextWithSearch(path, query, {
    budget: options?.budget,
    includes: options?.includes,
    excludes: options?.excludes,
    fast: !(options?.semantic ?? false),
    forceLarge: options?.forceLarge,
    onProgress: options?.onProgress,
  });
  return result.context;
}

/**
 * Quick helper to query with context
 */
export async function query(
  path: string,
  queryText: string,
  options?: {
    budget?: string | number;
    model?: string;
    includes?: string[];
    excludes?: string[];
    semantic?: boolean;  // Use semantic ranking instead of keyword-only
    onProgress?: (message: string) => void;
  }
) {
  const { buildContextWithSearch } = await import("./context-search");

  const result = await buildContextWithSearch(path, queryText, {
    budget: options?.budget,
    includes: options?.includes,
    excludes: options?.excludes,
    fast: !(options?.semantic ?? false),
    onProgress: options?.onProgress,
  });
  const { queryWithContext } = await import("./llm");

  const answer = await queryWithContext(
    result.context,
    queryText,
    options?.model || "gemini-flash-latest"
  );

  return answer;
}
