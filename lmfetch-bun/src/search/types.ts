/**
 * Structured code search types.
 */

export type SearchProviderMode = "auto" | "fff" | "ripgrep";

export type SearchFilePriority = "source" | "test" | "low-priority";

export type SearchReasonSignal =
  | "definition"
  | "file-priority"
  | "filename"
  | "match-count"
  | "provider"
  | "fallback";

export interface SearchCodeOptions {
  /** Optional glob scope passed to the provider */
  pathGlob?: string;
  /** Optional file type scope passed to the provider */
  fileType?: string;
  /** Maximum files to return */
  maxFiles?: number;
  /** Maximum matches to keep per file */
  maxMatchesPerFile?: number;
  /** Preferred search provider */
  provider?: SearchProviderMode;
  /** Progress callback */
  onProgress?: (message: string) => void;
}

export interface ResolvedSearchCodeOptions {
  pathGlob: string;
  fileType: string;
  maxFiles: number;
  maxMatchesPerFile: number;
  provider: SearchProviderMode;
  onProgress?: (message: string) => void;
}

export interface SearchMatch {
  line: number;
  text: string;
  isDefinition: boolean;
  ranges: Array<[number, number]>;
}

export interface SearchReason {
  signal: SearchReasonSignal;
  note: string;
}

export interface SearchFileResult {
  rank: number;
  path: string;
  priority: SearchFilePriority;
  hasDefinitionMatch: boolean;
  matchCount: number;
  reasons: SearchReason[];
  matches: SearchMatch[];
}

export interface SearchSummary {
  totalFilesMatched: number;
  shownFiles: number;
  sourceFiles: number;
  testFiles: number;
  lowPriorityFiles: number;
  definitionCandidates: number;
}

export interface SearchNextStep {
  action: "read_code";
  path: string;
  line: number;
}

export interface SearchResponse {
  provider: string;
  query: string;
  rootPath: string;
  scope: {
    pathGlob: string;
    fileType: string;
  };
  summary: SearchSummary;
  bestNextStep?: SearchNextStep;
  files: SearchFileResult[];
  warnings: string[];
}

export interface SearchProviderContext {
  userPath: string;
  rootPath: string;
  query: string;
  options: ResolvedSearchCodeOptions;
  progress: (message: string) => void;
}

export interface FindFilesOptions {
  /** Case-insensitive filename/path pattern */
  pattern?: string;
  /** Optional glob scope passed to the provider */
  pathGlob?: string;
  /** Optional file type scope passed to the provider */
  fileType?: string;
  /** Maximum files to return */
  maxResults?: number;
  /** Preferred search provider */
  provider?: SearchProviderMode;
  /** Progress callback */
  onProgress?: (message: string) => void;
}

export interface ResolvedFindFilesOptions {
  pattern: string;
  pathGlob: string;
  fileType: string;
  maxResults: number;
  provider: SearchProviderMode;
  onProgress?: (message: string) => void;
}

export interface FindFileResult {
  rank: number;
  path: string;
  priority: SearchFilePriority;
  reasons: SearchReason[];
}

export interface FindFilesResponse {
  provider: string;
  pattern: string;
  rootPath: string;
  scope: {
    pathGlob: string;
    fileType: string;
  };
  results: FindFileResult[];
  warnings: string[];
}

export interface FindFilesProviderContext {
  userPath: string;
  rootPath: string;
  options: ResolvedFindFilesOptions;
  progress: (message: string) => void;
}

export interface ReadCodeOptions {
  /** 1-indexed start line */
  startLine?: number;
  /** 1-indexed end line. 0 or undefined means derive from maxLines */
  endLine?: number;
  /** Maximum lines to return when endLine is omitted */
  maxLines?: number;
}

export interface ReadCodeLine {
  number: number;
  text: string;
}

export interface ReadCodeResponse {
  rootPath: string;
  requestedPath: string;
  resolvedPath: string;
  range: {
    startLine: number;
    endLine: number;
  };
  totalLines: number;
  truncated: boolean;
  lines: ReadCodeLine[];
}

export interface SearchProvider {
  readonly name: string;
  searchCode(context: SearchProviderContext): Promise<SearchResponse>;
  findFiles?(context: FindFilesProviderContext): Promise<FindFilesResponse>;
}
