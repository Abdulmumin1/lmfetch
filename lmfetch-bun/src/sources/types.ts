/**
 * Source file type definitions
 */

export interface SourceFile {
  /** Absolute path to the file */
  path: string;
  /** Path relative to the source root */
  relativePath: string;
  /** File content */
  content: string;
  /** Detected programming language */
  language: string;
  /** File size in bytes */
  size: number;
  /** Last modification time (Unix timestamp) */
  mtime: number;
}

export interface SourceOptions {
  /** Glob patterns to include */
  includes?: string[];
  /** Glob patterns to exclude */
  excludes?: string[];
  /** Process files larger than 1MB or 20k lines */
  forceLarge?: boolean;
}

export interface Source {
  /** Root path of the source */
  readonly rootPath: string;

  /** Discover and yield source files */
  discover(): AsyncGenerator<SourceFile>;

  /** Optional cleanup after processing */
  cleanup?(): Promise<void>;
}
