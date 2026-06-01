import { describeScope, truncateLine } from "./ranking";
import type { FindFilesResponse, ReadCodeResponse, SearchResponse } from "./types";

interface ReasonedFile {
  path: string;
  reasons: Array<{ note: string }>;
}

function appendGroupedReasons(parts: string[], files: ReasonedFile[]): void {
  const reasonPaths = new Map<string, string[]>();

  for (const file of files) {
    const uniqueNotes = new Set(file.reasons.map((reason) => reason.note));

    for (const note of uniqueNotes) {
      const paths = reasonPaths.get(note) ?? [];
      paths.push(file.path);
      reasonPaths.set(note, paths);
    }
  }

  if (reasonPaths.size === 0) {
    return;
  }

  parts.push("");
  parts.push("why:");

  for (const [note, paths] of reasonPaths) {
    parts.push(`  ${note}:`);
    for (const path of paths) {
      parts.push(`    ${path}`);
    }
  }
}

export function renderSearchResults(result: SearchResponse): string {
  if (result.files.length === 0) {
    return [
      "No matches found.",
      `  query: ${result.query}`,
      `  scope: ${describeScope(result.scope.pathGlob, result.scope.fileType)}`,
      `  provider: ${result.provider}`,
      "  hint: broaden the query, remove filters, or try a simpler symbol name.",
    ].join("\n");
  }

  const parts: string[] = [];
  parts.push("summary:");
  parts.push(`  query: ${result.query}`);
  parts.push(`  provider: ${result.provider}`);
  parts.push(`  scope: ${describeScope(result.scope.pathGlob, result.scope.fileType)}`);
  parts.push(
    `  files: ${result.summary.totalFilesMatched} total, ${result.summary.shownFiles} shown`,
  );
  parts.push(
    `  buckets: ${result.summary.sourceFiles} source, ${result.summary.testFiles} test, ${result.summary.lowPriorityFiles} low-priority`,
  );
  parts.push(`  definition_candidates: ${result.summary.definitionCandidates}`);

  if (result.bestNextStep) {
    parts.push(
      `  best_next_step: read ${result.bestNextStep.path} around line ${result.bestNextStep.line}`,
    );
  }

  for (const file of result.files) {
    parts.push("");
    parts.push(file.path);

    for (const match of file.matches) {
      parts.push(`  ${match.line}-${match.line}:`);
      parts.push(`    ${match.line}| ${truncateLine(match.text)}`);
    }
  }

  appendGroupedReasons(parts, result.files);

  if (result.warnings.length > 0) {
    parts.push("");
    for (const warning of result.warnings) {
      parts.push(`note: ${warning}`);
    }
  }

  return parts.join("\n");
}

export function renderFindFilesResults(result: FindFilesResponse): string {
  const parts: string[] = [];
  parts.push("summary:");
  parts.push(`  pattern: ${result.pattern || "(all files)"}`);
  parts.push(`  provider: ${result.provider}`);
  parts.push(`  scope: ${describeScope(result.scope.pathGlob, result.scope.fileType)}`);
  parts.push(`  files: ${result.results.length} shown`);

  for (const file of result.results) {
    parts.push("");
    parts.push(file.path);
  }

  appendGroupedReasons(parts, result.results);

  if (result.warnings.length > 0) {
    parts.push("");
    for (const warning of result.warnings) {
      parts.push(`note: ${warning}`);
    }
  }

  return parts.join("\n");
}

export function renderReadCodeResult(result: ReadCodeResponse): string {
  const parts: string[] = [];
  parts.push(`resolved: ${result.resolvedPath}`);
  parts.push(
    `range: ${result.range.startLine}-${result.range.endLine} of ${result.totalLines}`,
  );
  parts.push("");

  for (const line of result.lines) {
    parts.push(`${line.number}| ${line.text}`);
  }

  return parts.join("\n");
}
