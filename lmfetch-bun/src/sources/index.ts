/**
 * Source adapters for local and remote codebases
 */
export { CodebaseSource } from "./codebase";
export { GitHubSource, isGitHubUrl, createSource } from "./github";
export type { Source, SourceFile, SourceOptions } from "./types";
