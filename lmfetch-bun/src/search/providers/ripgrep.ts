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
  compareFoundFiles,
  compareSearchFiles,
  filePriority,
  isDefinitionLine,
  summarizeFiles,
} from "../ranking";

interface RipgrepJsonMatch {
  line_number?: number;
  lines?: { text?: string };
  path?: { text?: string };
  submatches?: Array<{ start?: number; end?: number }>;
}

export class RipgrepSearchProvider implements SearchProvider {
  readonly name = "ripgrep";

  async findFiles(context: FindFilesProviderContext): Promise<FindFilesResponse> {
    const { rootPath, options, progress } = context;
    progress("Finding files with ripgrep...");

    const args = ["rg", "--files"];

    if (options.pathGlob) {
      args.push("--glob", options.pathGlob);
    }

    if (options.fileType) {
      args.push("--type", options.fileType);
    }

    let proc: ReturnType<typeof Bun.spawn>;
    try {
      proc = Bun.spawn(args, {
        cwd: rootPath,
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch {
      throw new Error("ripgrep (rg) is not installed or not available on PATH");
    }

    const [stdout, stderr] = await Promise.all([
      proc.stdout
        ? new Response(proc.stdout as ReadableStream<Uint8Array>).text()
        : Promise.resolve(""),
      proc.stderr
        ? new Response(proc.stderr as ReadableStream<Uint8Array>).text()
        : Promise.resolve(""),
    ]);
    await proc.exited;

    const pattern = options.pattern.toLowerCase();
    const allFiles = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const filtered = allFiles.filter((path) => {
      if (!pattern) return true;
      return path.toLowerCase().includes(pattern);
    });

    const results = filtered
      .map((path) => ({
        rank: 0,
        path,
        priority: filePriority(path),
        reasons: buildFindFileReasons(path, options.pattern, filePriority(path)),
      }))
      .sort((a, b) => compareFoundFiles(a, b, options.pattern))
      .slice(0, options.maxResults)
      .map((file, index) => ({
        ...file,
        rank: index + 1,
      }));

    const warnings: string[] = [];
    if (stderr.trim()) {
      warnings.push(stderr.trim());
    }
    if (filtered.length > options.maxResults) {
      warnings.push(
        `truncated to top ${options.maxResults} files; refine the pattern or filters to narrow further`,
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
  }

  async searchCode(context: SearchProviderContext): Promise<SearchResponse> {
    const { rootPath, query, options, progress } = context;
    progress("Searching with ripgrep...");

    const args = ["rg", "--json"];

    if (options.pathGlob) {
      args.push("--glob", options.pathGlob);
    }

    if (options.fileType) {
      args.push("--type", options.fileType);
    }

    args.push("--", query, ".");

    let proc: ReturnType<typeof Bun.spawn>;
    try {
      proc = Bun.spawn(args, {
        cwd: rootPath,
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch {
      throw new Error("ripgrep (rg) is not installed or not available on PATH");
    }

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout
        ? new Response(proc.stdout as ReadableStream<Uint8Array>).text()
        : Promise.resolve(""),
      proc.stderr
        ? new Response(proc.stderr as ReadableStream<Uint8Array>).text()
        : Promise.resolve(""),
      proc.exited,
    ]);

    if (exitCode === 127) {
      throw new Error("ripgrep (rg) is not installed or not available on PATH");
    }

    const fileMap = new Map<string, SearchMatch[]>();

    for (const line of stdout.split("\n")) {
      if (!line.trim()) continue;

      let parsed: { type?: string; data?: RipgrepJsonMatch };
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }

      if (parsed.type !== "match" || !parsed.data) {
        continue;
      }

      const rawPath = parsed.data.path?.text;
      const lineNumber = parsed.data.line_number;
      const lineText = parsed.data.lines?.text?.replace(/\n$/, "");

      if (!rawPath || !lineNumber || !lineText) {
        continue;
      }

      const path = rawPath.startsWith("./") ? rawPath.slice(2) : rawPath;
      const match: SearchMatch = {
        line: lineNumber,
        text: lineText,
        isDefinition: isDefinitionLine(lineText),
        ranges: (parsed.data.submatches ?? [])
          .map((submatch) => [submatch.start ?? 0, submatch.end ?? 0] as [number, number])
          .filter(([start, end]) => end > start),
      };

      const matches = fileMap.get(path) ?? [];
      matches.push(match);
      fileMap.set(path, matches);
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
      const result: SearchFileResult = {
        rank: 0,
        path,
        priority: filePriority(path),
        hasDefinitionMatch,
        matchCount: matches.length,
        reasons: [],
        matches: limitedMatches,
      };
      result.reasons = buildFileReasons(result);
      return result;
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
    if (stderr.trim() && exitCode > 1) {
      warnings.push(stderr.trim());
    }
    if (totalFilesMatched > options.maxFiles) {
      warnings.push(
        `truncated to top ${options.maxFiles} files; refine the query or filters to narrow further`,
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
  }
}
