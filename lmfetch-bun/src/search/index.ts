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

function broadenQuery(query: string): string | undefined {
  const terms = Array.from(new Set(query.match(/[A-Za-z0-9_.$/-]{3,}/g) ?? []));
  if (terms.length < 2) {
    return undefined;
  }

  return terms
    .slice(0, 8)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
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
    const result = await provider.searchCode({
      userPath: path,
      rootPath,
      query,
      options: resolvedOptions,
      progress,
    });

    const expandedQuery = result.files.length === 0 ? broadenQuery(query) : undefined;
    if (!expandedQuery) {
      return result;
    }

    const expanded = await provider.searchCode({
      userPath: path,
      rootPath,
      query: expandedQuery,
      options: resolvedOptions,
      progress,
    });
    expanded.query = query;
    expanded.warnings.unshift(
      `no exact matches; broadened search to individual terms: ${expandedQuery}`,
    );
    return expanded;
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
