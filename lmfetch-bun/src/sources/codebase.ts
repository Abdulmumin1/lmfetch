/**
 * Local codebase source adapter
 */
import { Glob } from "bun";
import ignore, { type Ignore } from "ignore";
import { join, relative, dirname } from "path";
import { readFile, stat } from "fs/promises";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { detectLanguage } from "../utils";
import type { Source, SourceFile, SourceOptions } from "./types";

// Default directories to always exclude
const DEFAULT_EXCLUDES = [
  ".git",
  ".git/**",
  "node_modules",
  "node_modules/**",
  "__pycache__",
  "__pycache__/**",
  ".venv",
  ".venv/**",
  "venv",
  "venv/**",
  ".env",
  "dist",
  "dist/**",
  "build",
  "build/**",
  ".next",
  ".next/**",
  ".nuxt",
  ".nuxt/**",
  ".output",
  ".output/**",
  "coverage",
  "coverage/**",
  ".pytest_cache",
  ".pytest_cache/**",
  ".mypy_cache",
  ".mypy_cache/**",
  ".ruff_cache",
  ".ruff_cache/**",
  "target", // Rust
  "target/**",
  "vendor", // Go
  "vendor/**",
  ".idea",
  ".idea/**",
  ".vscode",
  ".vscode/**",
  "*.min.js",
  "*.min.css",
  "*.map",
  "*.lock",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
];

// Binary and media file extensions to skip
const BINARY_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
  "ico",
  "webp",
  "svg",
  "mp3",
  "mp4",
  "wav",
  "avi",
  "mov",
  "pdf",
  "zip",
  "tar",
  "gz",
  "rar",
  "7z",
  "exe",
  "dll",
  "so",
  "dylib",
  "woff",
  "woff2",
  "ttf",
  "eot",
  "otf",
  "pyc",
  "pyo",
  "class",
  "o",
  "a",
  "lib",
]);

const MAX_FILE_SIZE = 1024 * 1024; // 1MB
const MAX_LINES = 20000;

/**
 * Represents a gitignore file with its directory context
 */
interface GitignoreEntry {
  /** Directory containing the .gitignore */
  dir: string;
  /** Ignore instance for this .gitignore */
  ig: Ignore;
}

export class CodebaseSource implements Source {
  readonly rootPath: string;
  private rootIgnore: Ignore;
  private nestedIgnores: GitignoreEntry[] = [];
  private includes: string[];
  private excludes: string[];
  private forceLarge: boolean;

  constructor(rootPath: string, options: SourceOptions = {}) {
    this.rootPath = rootPath;
    this.includes = options.includes || [];
    this.excludes = options.excludes || [];
    this.forceLarge = options.forceLarge || false;

    // Initialize root ignore with defaults
    this.rootIgnore = ignore();
    this.addDefaultExcludes();
    this.addUserExcludes();

    // Load all .gitignore files in the codebase
    this.loadAllGitignores();
  }

  /**
   * Recursively find and load all .gitignore files
   */
  private loadAllGitignores(): void {
    this.scanForGitignores(this.rootPath, "");
  }

  /**
   * Scan a directory for .gitignore files
   */
  private scanForGitignores(absoluteDir: string, relativeDir: string): void {
    try {
      const gitignorePath = join(absoluteDir, ".gitignore");

      if (existsSync(gitignorePath)) {
        const content = readFileSync(gitignorePath, "utf-8");
        if (content.trim()) {
          const ig = ignore().add(content);

          if (relativeDir === "") {
            // Root gitignore - add to root ignore
            this.rootIgnore.add(content);
          } else {
            // Nested gitignore - store with directory context
            this.nestedIgnores.push({
              dir: relativeDir,
              ig,
            });
          }
        }
      }

      // Scan subdirectories (but skip ignored ones)
      const entries = readdirSync(absoluteDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        // Skip common ignored directories to speed up scanning
        if (
          entry.name === ".git" ||
          entry.name === "node_modules" ||
          entry.name === "__pycache__" ||
          entry.name === ".venv" ||
          entry.name === "venv" ||
          entry.name === "dist" ||
          entry.name === "build" ||
          entry.name === ".next" ||
          entry.name === "target" ||
          entry.name === "vendor" ||
          entry.name === ".idea" ||
          entry.name === ".vscode" ||
          entry.name === "coverage"
        ) {
          continue;
        }

        const childAbsolute = join(absoluteDir, entry.name);
        const childRelative = relativeDir
          ? `${relativeDir}/${entry.name}`
          : entry.name;

        this.scanForGitignores(childAbsolute, childRelative);
      }
    } catch {
      // Can't read directory, skip
    }
  }

  private addDefaultExcludes(): void {
    this.rootIgnore.add(DEFAULT_EXCLUDES);
  }

  private addUserExcludes(): void {
    if (this.excludes.length > 0) {
      this.rootIgnore.add(this.excludes);
    }
  }

  /**
   * Check if a path is ignored by any gitignore
   */
  private isIgnored(relativePath: string): boolean {
    // Check root ignore first
    if (this.rootIgnore.ignores(relativePath)) {
      return true;
    }

    // Check nested gitignores
    for (const { dir, ig } of this.nestedIgnores) {
      // Only apply if the file is within this directory
      if (relativePath.startsWith(dir + "/")) {
        // Get the path relative to the gitignore's directory
        const localPath = relativePath.slice(dir.length + 1);
        if (ig.ignores(localPath)) {
          return true;
        }
      }
    }

    return false;
  }

  private shouldInclude(relativePath: string): boolean {
    // Check if ignored by any gitignore
    if (this.isIgnored(relativePath)) {
      return false;
    }

    // Check binary extensions
    const ext = relativePath.split(".").pop()?.toLowerCase() || "";
    if (BINARY_EXTENSIONS.has(ext)) {
      return false;
    }

    // Check user includes (if specified, only include matching files)
    if (this.includes.length > 0) {
      const matches = this.includes.some((pattern) => {
        const glob = new Glob(pattern);
        return glob.match(relativePath);
      });
      if (!matches) {
        return false;
      }
    }

    return true;
  }

  private isTooLarge(content: string, size: number): boolean {
    if (this.forceLarge) return false;

    if (size > MAX_FILE_SIZE) return true;

    const lineCount = content.split("\n").length;
    if (lineCount > MAX_LINES) return true;

    return false;
  }

  async *discover(): AsyncGenerator<SourceFile> {
    const glob = new Glob("**/*");

    for await (const entry of glob.scan({
      cwd: this.rootPath,
      onlyFiles: true,
      dot: false,
    })) {
      const relativePath = entry;
      const absolutePath = join(this.rootPath, entry);

      if (!this.shouldInclude(relativePath)) {
        continue;
      }

      try {
        const fileStat = await stat(absolutePath);

        // Skip directories (shouldn't happen with onlyFiles, but safety check)
        if (!fileStat.isFile()) continue;

        // Quick size check before reading
        if (!this.forceLarge && fileStat.size > MAX_FILE_SIZE) {
          continue;
        }

        const content = await readFile(absolutePath, "utf-8");

        // Check if too large after reading (for line count)
        if (this.isTooLarge(content, fileStat.size)) {
          continue;
        }

        const language = detectLanguage(relativePath);

        yield {
          path: absolutePath,
          relativePath,
          content,
          language,
          size: fileStat.size,
          mtime: fileStat.mtimeMs,
        };
      } catch (err) {
        // Skip files that can't be read (permissions, encoding issues, etc.)
        continue;
      }
    }
  }
}
