import { ContextBuilder, type BuildResult, type CandidateLineRange } from "./builder";
import { searchCode, type SearchProviderMode } from "./search";

export interface SearchFirstContextOptions {
  budget?: string | number;
  includes?: string[];
  excludes?: string[];
  fast?: boolean;
  forceLarge?: boolean;
  onProgress?: (message: string) => void;
  searchMaxFiles?: number;
  searchProvider?: SearchProviderMode;
  searchContextLines?: number;
}

function mergeRanges(ranges: CandidateLineRange[]): CandidateLineRange[] {
  const byPath = new Map<string, CandidateLineRange[]>();
  for (const range of ranges) {
    const existing = byPath.get(range.path) ?? [];
    existing.push(range);
    byPath.set(range.path, existing);
  }

  const merged: CandidateLineRange[] = [];
  for (const [path, pathRanges] of byPath) {
    pathRanges.sort((a, b) => a.startLine - b.startLine);
    for (const range of pathRanges) {
      const previous = merged[merged.length - 1];
      if (previous?.path === path && range.startLine <= previous.endLine + 1) {
        previous.endLine = Math.max(previous.endLine, range.endLine);
      } else {
        merged.push({ ...range });
      }
    }
  }

  return merged;
}

function rangesFromSearch(search: Awaited<ReturnType<typeof searchCode>>, contextLines: number): CandidateLineRange[] {
  const ranges: CandidateLineRange[] = [];
  for (const file of search.files) {
    for (const match of file.matches) {
      ranges.push({
        path: file.path,
        startLine: Math.max(1, match.line - contextLines),
        endLine: match.line + contextLines,
      });
    }
  }

  return mergeRanges(ranges);
}

export async function buildContextWithSearch(
  path: string,
  query: string,
  options: SearchFirstContextOptions = {},
): Promise<BuildResult> {
  const progress = options.onProgress ?? (() => {});
  const buildFullContext = () =>
    new ContextBuilder({
      path,
      query,
      budget: options.budget,
      includes: options.includes,
      excludes: options.excludes,
      fast: options.fast,
      forceLarge: options.forceLarge,
      onProgress: progress,
    }).build();

  try {
    progress("Searching for candidate files...");
    const search = await searchCode(path, query, {
      pathGlob: options.includes?.length === 1 ? options.includes[0] : undefined,
      maxFiles: Math.max(1, options.searchMaxFiles ?? 12),
      provider: options.searchProvider ?? "auto",
      onProgress: progress,
    });

    if (search.files.length === 0) {
      progress("Search returned no candidates; falling back to full scan...");
      return await buildFullContext();
    }

    progress(`Search-first selected ${search.files.length} candidate files`);
    const candidateLineRanges = rangesFromSearch(
      search,
      Math.max(0, options.searchContextLines ?? 80),
    );
    const narrowed = await new ContextBuilder({
      path,
      query,
      budget: options.budget,
      includes: options.includes,
      excludes: options.excludes,
      candidateFiles: search.files.map((file) => file.path),
      candidateLineRanges,
      fast: options.fast,
      forceLarge: options.forceLarge,
      onProgress: progress,
    }).build();

    if (narrowed.filesProcessed === 0 || narrowed.chunksCreated === 0) {
      progress("Search-first produced no usable chunks; falling back to full scan...");
      return await buildFullContext();
    }

    return narrowed;
  } catch (error) {
    progress(`Search-first failed: ${(error as Error).message}. Falling back to full scan...`);
    return await buildFullContext();
  }
}
