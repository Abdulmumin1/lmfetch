import type {
  FindFileResult,
  SearchFilePriority,
  SearchFileResult,
  SearchReason,
  SearchSummary,
} from "./types";

const LOW_PRIORITY_DIRS = new Set([
  "example",
  "examples",
  "sample",
  "samples",
  "fixture",
  "fixtures",
  "mock",
  "mocks",
  "testdata",
  "vendor",
  "node_modules",
  "third_party",
  ".research",
  ".chump",
]);

const TEST_DIRS = new Set(["test", "tests", "testing", "spec", "specs"]);

export function truncateLine(line: string, maxChars: number = 180): string {
  if (line.length === 0) return line;

  const chars = Array.from(line);
  if (chars.length <= maxChars) {
    return line;
  }
  return `${chars.slice(0, maxChars).join("")}…`;
}

export function isDefinitionLine(content: string): boolean {
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (
      trimmed.startsWith("//") ||
      trimmed.startsWith("#") ||
      trimmed.startsWith("/*") ||
      trimmed.startsWith("*")
    ) {
      continue;
    }

    if (matchesDefinitionPrefix(trimmed)) {
      return true;
    }
  }

  return false;
}

function matchesDefinitionPrefix(trimmed: string): boolean {
  if (
    trimmed.startsWith("fn ") ||
    trimmed.startsWith("pub fn ") ||
    trimmed.startsWith("pub(crate) fn ") ||
    trimmed.startsWith("struct ") ||
    trimmed.startsWith("pub struct ") ||
    trimmed.startsWith("enum ") ||
    trimmed.startsWith("pub enum ") ||
    trimmed.startsWith("trait ") ||
    trimmed.startsWith("pub trait ") ||
    trimmed.startsWith("impl ") ||
    trimmed.startsWith("impl<") ||
    trimmed.startsWith("type ") ||
    trimmed.startsWith("pub type ") ||
    trimmed.startsWith("mod ") ||
    trimmed.startsWith("pub mod ")
  ) {
    return true;
  }

  if (trimmed.startsWith("func ")) {
    return true;
  }

  if (trimmed.startsWith("type ")) {
    const rest = trimmed.slice("type ".length);
    if (rest.includes(" struct") || rest.includes(" interface")) {
      return true;
    }
  }

  if (trimmed.startsWith("class ") || trimmed.startsWith("def ")) {
    return true;
  }

  if (
    trimmed.startsWith("export default ") ||
    trimmed.startsWith("export async function ") ||
    trimmed.startsWith("export function ") ||
    trimmed.startsWith("export class ") ||
    trimmed.startsWith("export const ") ||
    trimmed.startsWith("export let ") ||
    trimmed.startsWith("export var ") ||
    trimmed.startsWith("export interface ") ||
    trimmed.startsWith("export type ") ||
    trimmed.startsWith("export enum ")
  ) {
    return true;
  }

  if (
    trimmed.startsWith("function ") ||
    trimmed.startsWith("class ") ||
    trimmed.startsWith("interface ") ||
    trimmed.startsWith("module.exports")
  ) {
    return true;
  }

  if (
    trimmed.startsWith("struct ") ||
    trimmed.startsWith("enum ") ||
    trimmed.startsWith("union ") ||
    trimmed.startsWith("typedef ")
  ) {
    return true;
  }

  return false;
}

export function filePriorityValue(path: string): 0 | 1 | 2 {
  const components = path.split(/[\\/]/).filter(Boolean);
  const filename = components.at(-1)?.toLowerCase() ?? "";

  if (
    filename.endsWith(".md") ||
    filename.endsWith(".mdx") ||
    filename.endsWith(".rst") ||
    filename === "license" ||
    filename === "changelog.md" ||
    filename.endsWith(".lock") ||
    filename.endsWith(".lockb")
  ) {
    return 2;
  }

  for (const component of components) {
    if (LOW_PRIORITY_DIRS.has(component.toLowerCase())) {
      return 2;
    }
  }

  for (const component of components.slice(0, -1)) {
    if (TEST_DIRS.has(component.toLowerCase())) {
      return 1;
    }
  }

  if (
    filename.includes("_test.") ||
    filename.startsWith("test_") ||
    filename.includes(".test.") ||
    filename.includes(".spec.")
  ) {
    return 1;
  }

  return 0;
}

export function filePriority(path: string): SearchFilePriority {
  const value = filePriorityValue(path);
  if (value === 0) return "source";
  if (value === 1) return "test";
  return "low-priority";
}

export function compareSearchFiles(a: SearchFileResult, b: SearchFileResult): number {
  if (a.hasDefinitionMatch !== b.hasDefinitionMatch) {
    return a.hasDefinitionMatch ? -1 : 1;
  }

  const priorityCompare = filePriorityValue(a.path) - filePriorityValue(b.path);
  if (priorityCompare !== 0) {
    return priorityCompare;
  }

  return a.path.localeCompare(b.path);
}

export function summarizeFiles(
  files: SearchFileResult[],
  totalFilesMatched: number,
): SearchSummary {
  let sourceFiles = 0;
  let testFiles = 0;
  let lowPriorityFiles = 0;
  let definitionCandidates = 0;

  for (const file of files) {
    if (file.priority === "source") sourceFiles += 1;
    if (file.priority === "test") testFiles += 1;
    if (file.priority === "low-priority") lowPriorityFiles += 1;
    if (file.hasDefinitionMatch) definitionCandidates += 1;
  }

  return {
    totalFilesMatched,
    shownFiles: files.length,
    sourceFiles,
    testFiles,
    lowPriorityFiles,
    definitionCandidates,
  };
}

export function buildFileReasons(file: Pick<SearchFileResult, "priority" | "hasDefinitionMatch" | "matchCount">): SearchReason[] {
  const reasons: SearchReason[] = [];

  if (file.hasDefinitionMatch) {
    reasons.push({
      signal: "definition",
      note: "contains a definition-like match",
    });
  }

  if (file.priority === "source") {
    reasons.push({
      signal: "file-priority",
      note: "source path ranked ahead of tests and generated paths",
    });
  } else if (file.priority === "test") {
    reasons.push({
      signal: "file-priority",
      note: "test path kept behind source files",
    });
  } else {
    reasons.push({
      signal: "file-priority",
      note: "low-priority path de-emphasized",
    });
  }

  if (file.matchCount > 1) {
    reasons.push({
      signal: "match-count",
      note: `multiple matches in file (${file.matchCount})`,
    });
  }

  return reasons;
}

export function buildFindFileReasons(
  path: string,
  pattern: string,
  priority: SearchFilePriority,
): SearchReason[] {
  const reasons: SearchReason[] = [];
  const loweredPattern = pattern.trim().toLowerCase();
  const loweredPath = path.toLowerCase();
  const filename = loweredPath.split("/").at(-1) ?? loweredPath;

  if (loweredPattern) {
    if (filename === loweredPattern) {
      reasons.push({ signal: "filename", note: "exact filename match" });
    } else if (filename.startsWith(loweredPattern)) {
      reasons.push({ signal: "filename", note: "filename prefix match" });
    } else if (filename.includes(loweredPattern)) {
      reasons.push({ signal: "filename", note: "filename contains pattern" });
    } else if (loweredPath.includes(loweredPattern)) {
      reasons.push({ signal: "filename", note: "path contains pattern" });
    }
  }

  reasons.push(...buildFileReasons({ priority, hasDefinitionMatch: false, matchCount: 0 }));
  return reasons.filter((reason) => reason.signal !== "match-count");
}

function filePatternRank(path: string, pattern: string): number {
  const loweredPattern = pattern.trim().toLowerCase();
  if (!loweredPattern) return 4;

  const loweredPath = path.toLowerCase();
  const filename = loweredPath.split("/").at(-1) ?? loweredPath;

  if (filename === loweredPattern) return 0;
  if (filename.startsWith(loweredPattern)) return 1;
  if (filename.includes(loweredPattern)) return 2;
  if (loweredPath.includes(loweredPattern)) return 3;
  return 4;
}

export function compareFoundFiles(
  a: FindFileResult,
  b: FindFileResult,
  pattern: string,
): number {
  const patternCompare = filePatternRank(a.path, pattern) - filePatternRank(b.path, pattern);
  if (patternCompare !== 0) {
    return patternCompare;
  }

  const priorityCompare = filePriorityValue(a.path) - filePriorityValue(b.path);
  if (priorityCompare !== 0) {
    return priorityCompare;
  }

  return a.path.localeCompare(b.path);
}

export function describeScope(pathGlob: string, fileType: string): string {
  const parts: string[] = [];
  if (pathGlob) parts.push(`glob=${pathGlob}`);
  if (fileType) parts.push(`type=${fileType}`);
  return parts.length > 0 ? parts.join(", ") : "all indexed files";
}
