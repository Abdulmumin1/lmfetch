import { FffSearchProvider, isFffAvailable } from "./providers/fff";
import { RipgrepSearchProvider } from "./providers/ripgrep";
import { findFiles } from "./find-files";
import { readCode } from "./read-code";
import { resolveSearchRoot } from "./source-root";
import type {
  ResolvedSearchCodeOptions,
  SearchCodeOptions,
  SearchProvider,
  SearchProviderMode,
  SearchResponse,
} from "./types";

function resolveOptions(options: SearchCodeOptions = {}): ResolvedSearchCodeOptions {
  return {
    pathGlob: options.pathGlob ?? "",
    fileType: options.fileType ?? "",
    maxFiles: Math.max(1, options.maxFiles ?? 10),
    maxMatchesPerFile: Math.max(1, options.maxMatchesPerFile ?? 3),
    provider: options.provider ?? "auto",
    onProgress: options.onProgress,
  };
}

async function chooseProvider(mode: SearchProviderMode, options: ResolvedSearchCodeOptions): Promise<SearchProvider> {
  if (mode === "ripgrep") {
    return new RipgrepSearchProvider();
  }

  if (mode === "fff") {
    if (!(await isFffAvailable())) {
      throw new Error("FFF provider requested but @ff-labs/fff-node is not installed");
    }
    return new FffSearchProvider();
  }

  if (!options.pathGlob && !options.fileType && (await isFffAvailable())) {
    return new FffSearchProvider();
  }

  return new RipgrepSearchProvider();
}

export async function searchCode(
  path: string,
  query: string,
  options?: SearchCodeOptions,
): Promise<SearchResponse> {
  const resolvedOptions = resolveOptions(options);
  const progress = resolvedOptions.onProgress ?? (() => {});

  if (!query.trim()) {
    throw new Error("query is required");
  }

  const rootPath = await resolveSearchRoot(path);
  const provider = await chooseProvider(resolvedOptions.provider, resolvedOptions);

  try {
    return await provider.searchCode({
      userPath: path,
      rootPath,
      query,
      options: resolvedOptions,
      progress,
    });
  } catch (error) {
    if (provider.name === "fff" && resolvedOptions.provider === "auto") {
      const fallback = new RipgrepSearchProvider();
      const result = await fallback.searchCode({
        userPath: path,
        rootPath,
        query,
        options: resolvedOptions,
        progress,
      });
      result.warnings.unshift(
        `FFF provider failed and lmfetch fell back to ripgrep: ${(error as Error).message}`,
      );
      return result;
    }

    throw error;
  }
}

export { findFiles, readCode };
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
} from "./types";
export {
  renderFindFilesResults,
  renderReadCodeResult,
  renderSearchResults,
} from "./format";
