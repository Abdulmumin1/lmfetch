import type {
  FindFilesProviderContext,
  FindFilesResponse,
  SearchFileResult,
  SearchMatch,
  SearchProvider,
  SearchProviderContext,
  SearchResponse,
} from "../types";
import {
  buildFindFileReasons,
  buildFileReasons,
  compareSearchFiles,
  filePriority,
  summarizeFiles,
} from "../ranking";

const dynamicImport = new Function(
  "specifier",
  "return import(specifier);",
) as (specifier: string) => Promise<any>;

let cachedModule: any | null | undefined;

async function loadFffModule(): Promise<any | null> {
  if (cachedModule !== undefined) {
    return cachedModule;
  }

  try {
    cachedModule = await dynamicImport("@ff-labs/fff-node");
    return cachedModule;
  } catch {
    cachedModule = null;
    return null;
  }
}

function inferMode(query: string): "plain" | "regex" {
  return /[.\\+*?\[\](){}|^$]/.test(query) ? "regex" : "plain";
}

export async function isFffAvailable(): Promise<boolean> {
  const mod = await loadFffModule();
  return Boolean(mod?.FileFinder);
}

export class FffSearchProvider implements SearchProvider {
  readonly name = "fff";

  async findFiles(context: FindFilesProviderContext): Promise<FindFilesResponse> {
    const { rootPath, options, progress } = context;

    if (options.pathGlob || options.fileType) {
      throw new Error("FFF provider does not yet support path_glob or file_type filters");
    }

    const mod = await loadFffModule();
    if (!mod?.FileFinder) {
      throw new Error("@ff-labs/fff-node is not installed");
    }

    progress("Finding files with fff...");

    const created = mod.FileFinder.create({
      basePath: rootPath,
      aiMode: true,
      disableWatch: true,
    });

    if (!created.ok) {
      throw new Error(created.error);
    }

    const finder = created.value;

    try {
      const waitResult = await finder.waitForScan(5000);
      if (!waitResult.ok) {
        throw new Error(waitResult.error);
      }

      const result = finder.fileSearch(options.pattern || "*", {
        pageSize: Math.max(50, options.maxResults * 4),
      });

      if (!result.ok) {
        throw new Error(result.error);
      }

      const results = result.value.items.slice(0, options.maxResults).map((item: any, index: number) => {
        const priority = filePriority(item.relativePath);
        return {
          rank: index + 1,
          path: item.relativePath,
          priority,
          reasons: [
            { signal: "provider", note: "ranked by fff fuzzy file search" },
            ...buildFindFileReasons(item.relativePath, options.pattern, priority),
          ],
        };
      });

      const warnings: string[] = [];
      if (result.value.totalMatched > options.maxResults) {
        warnings.push(
          `truncated to top ${options.maxResults} files; refine the pattern to narrow further`,
        );
      }

      return {
        provider: this.name,
        pattern: options.pattern,
        rootPath,
        scope: {
          pathGlob: options.pathGlob,
          fileType: options.fileType,
        },
        results,
        warnings,
      };
    } finally {
      finder.destroy();
    }
  }

  async searchCode(context: SearchProviderContext): Promise<SearchResponse> {
    const { rootPath, query, options, progress } = context;

    if (options.pathGlob || options.fileType) {
      throw new Error("FFF provider does not yet support path_glob or file_type filters");
    }

    const mod = await loadFffModule();
    if (!mod?.FileFinder) {
      throw new Error("@ff-labs/fff-node is not installed");
    }

    progress("Searching with fff...");

    const created = mod.FileFinder.create({
      basePath: rootPath,
      aiMode: true,
      disableWatch: true,
    });

    if (!created.ok) {
      throw new Error(created.error);
    }

    const finder = created.value;

    try {
      const waitResult = await finder.waitForScan(5000);
      if (!waitResult.ok) {
        throw new Error(waitResult.error);
      }

      const result = finder.grep(query, {
        mode: inferMode(query),
        pageSize: Math.max(50, options.maxFiles * options.maxMatchesPerFile * 4),
        maxMatchesPerFile: options.maxMatchesPerFile,
        classifyDefinitions: true,
      });

      if (!result.ok) {
        throw new Error(result.error);
      }

      const fileMap = new Map<string, SearchMatch[]>();
      for (const item of result.value.items) {
        const matches = fileMap.get(item.relativePath) ?? [];
        matches.push({
          line: item.lineNumber,
          text: item.lineContent,
          isDefinition: item.isDefinition ?? false,
          ranges: item.matchRanges,
        });
        fileMap.set(item.relativePath, matches);
      }

      let files = Array.from(fileMap.entries()).map(([path, matches]) => {
        matches.sort((a, b) => {
          if (a.isDefinition !== b.isDefinition) {
            return a.isDefinition ? -1 : 1;
          }
          return a.line - b.line;
        });

        const limitedMatches = matches.slice(0, options.maxMatchesPerFile);
        const hasDefinitionMatch = matches.some((match) => match.isDefinition);
        const file: SearchFileResult = {
          rank: 0,
          path,
          priority: filePriority(path),
          hasDefinitionMatch,
          matchCount: matches.length,
          reasons: [],
          matches: limitedMatches,
        };
        file.reasons = [
          { signal: "provider", note: "ranked by fff warm index and grep ordering" },
          ...buildFileReasons(file),
        ];
        return file;
      });

      files.sort(compareSearchFiles);
      const totalFilesMatched = files.length;
      files = files.slice(0, options.maxFiles).map((file, index) => ({
        ...file,
        rank: index + 1,
      }));

      const summary = summarizeFiles(files, totalFilesMatched);
      const bestFile = files[0];
      const bestMatch = bestFile?.matches[0];
      const warnings: string[] = [];

      if (result.value.regexFallbackError) {
        warnings.push(`regex fallback: ${result.value.regexFallbackError}`);
      }
      if (totalFilesMatched > options.maxFiles) {
        warnings.push(
          `truncated to top ${options.maxFiles} files; refine the query to narrow further`,
        );
      }

      return {
        provider: this.name,
        query,
        rootPath,
        scope: {
          pathGlob: options.pathGlob,
          fileType: options.fileType,
        },
        summary,
        bestNextStep: bestFile && bestMatch
          ? {
              action: "read_code",
              path: bestFile.path,
              line: bestMatch.line,
            }
          : undefined,
        files,
        warnings,
      };
    } finally {
      finder.destroy();
    }
  }
}
