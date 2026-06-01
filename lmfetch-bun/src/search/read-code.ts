import { readFile } from "fs/promises";
import { isAbsolute, join, relative, resolve } from "path";
import { resolveSearchRoot } from "./source-root";
import type { ReadCodeOptions, ReadCodeResponse } from "./types";

function normalizeRelativePath(path: string): string {
  return path.replace(/^\.\//, "").replace(/\\/g, "/");
}

function clampPositiveInteger(value: number | undefined, fallback: number): number {
  if (!value || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.floor(value));
}

async function listRepoFiles(rootPath: string): Promise<string[]> {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(["rg", "--files"], {
      cwd: rootPath,
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch {
    throw new Error("ripgrep (rg) is required to resolve non-exact file paths");
  }

  const stdout = proc.stdout
    ? await new Response(proc.stdout as ReadableStream<Uint8Array>).text()
    : "";
  await proc.exited;
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

async function resolveRequestedPath(rootPath: string, requestedPath: string): Promise<string> {
  const normalizedRequested = normalizeRelativePath(requestedPath);

  const exactCandidates = new Set<string>();
  exactCandidates.add(normalizedRequested);

  if (isAbsolute(requestedPath)) {
    const absolute = resolve(requestedPath);
    if (absolute.startsWith(rootPath)) {
      exactCandidates.add(normalizeRelativePath(relative(rootPath, absolute)));
    }
  }

  for (const candidate of exactCandidates) {
    const absolutePath = join(rootPath, candidate);
    if (await Bun.file(absolutePath).exists()) {
      return candidate;
    }
  }

  const repoFiles = await listRepoFiles(rootPath);
  const suffixMatches = repoFiles.filter(
    (file) => file === normalizedRequested || file.endsWith(`/${normalizedRequested}`),
  );

  if (suffixMatches.length === 1) {
    return suffixMatches[0];
  }

  if (suffixMatches.length > 1) {
    throw new Error(
      `Path is ambiguous: ${requestedPath}. Matches: ${suffixMatches.slice(0, 10).join(", ")}`,
    );
  }

  throw new Error(`File not found: ${requestedPath}`);
}

export async function readCode(
  path: string,
  requestedPath: string,
  options: ReadCodeOptions = {},
): Promise<ReadCodeResponse> {
  const rootPath = await resolveSearchRoot(path);
  const resolvedPath = await resolveRequestedPath(rootPath, requestedPath);
  const absolutePath = join(rootPath, resolvedPath);

  const fileContent = await readFile(absolutePath, "utf-8");
  const lines = fileContent.replace(/\r\n/g, "\n").split("\n");
  const totalLines = lines.length;

  const startLine = clampPositiveInteger(options.startLine, 1);
  const maxLines = clampPositiveInteger(options.maxLines, 80);
  const requestedEnd = options.endLine && options.endLine > 0
    ? Math.floor(options.endLine)
    : startLine + maxLines - 1;
  const endLine = Math.max(startLine, Math.min(totalLines, requestedEnd));

  const selected = lines.slice(startLine - 1, endLine).map((text, index) => ({
    number: startLine + index,
    text,
  }));

  return {
    rootPath,
    requestedPath,
    resolvedPath,
    range: {
      startLine,
      endLine,
    },
    totalLines,
    truncated: startLine !== 1 || endLine !== totalLines,
    lines: selected,
  };
}
