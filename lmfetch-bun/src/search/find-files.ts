import { FffSearchProvider, isFffAvailable } from "./providers/fff";
import { RipgrepSearchProvider } from "./providers/ripgrep";
import { resolveSearchRoot } from "./source-root";
import type {
  FindFilesOptions,
  FindFilesResponse,
  ResolvedFindFilesOptions,
  SearchProvider,
  SearchProviderMode,
} from "./types";

function resolveOptions(options: FindFilesOptions = {}): ResolvedFindFilesOptions {
  return {
    pattern: options.pattern?.trim() ?? "",
    pathGlob: options.pathGlob ?? "",
    fileType: options.fileType ?? "",
    maxResults: Math.max(1, options.maxResults ?? 50),
    provider: options.provider ?? "auto",
    onProgress: options.onProgress,
  };
}

async function chooseProvider(
  mode: SearchProviderMode,
  options: ResolvedFindFilesOptions,
): Promise<SearchProvider> {
  if (mode === "ripgrep") {
    return new RipgrepSearchProvider();
  }

  if (mode === "fff") {
    if (!(await isFffAvailable())) {
      throw new Error("FFF provider requested but @ff-labs/fff-node is not installed");
    }
    return new FffSearchProvider();
  }

  if (options.pattern && !options.pathGlob && !options.fileType && (await isFffAvailable())) {
    return new FffSearchProvider();
  }

  return new RipgrepSearchProvider();
}

export async function findFiles(
  path: string,
  pattern?: string,
  options?: Omit<FindFilesOptions, "pattern">,
): Promise<FindFilesResponse> {
  const resolvedOptions = resolveOptions({ ...options, pattern });
  const progress = resolvedOptions.onProgress ?? (() => {});
  const rootPath = await resolveSearchRoot(path);
  const provider = await chooseProvider(resolvedOptions.provider, resolvedOptions);

  try {
    if (!provider.findFiles) {
      throw new Error(`provider ${provider.name} does not support file search`);
    }

    return await provider.findFiles({
      userPath: path,
      rootPath,
      options: resolvedOptions,
      progress,
    });
  } catch (error) {
    if (provider.name === "fff" && resolvedOptions.provider === "auto") {
      const fallback = new RipgrepSearchProvider();
      const result = await fallback.findFiles!({
        userPath: path,
        rootPath,
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
