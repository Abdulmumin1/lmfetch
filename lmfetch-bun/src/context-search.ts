import { ContextBuilder, type BuildResult } from "./builder";
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
    const narrowed = await new ContextBuilder({
      path,
      query,
      budget: options.budget,
      includes: options.includes,
      excludes: options.excludes,
      candidateFiles: search.files.map((file) => file.path),
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
