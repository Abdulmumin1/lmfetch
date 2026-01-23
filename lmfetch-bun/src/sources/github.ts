/**
 * GitHub repository source adapter
 */
import { $ } from "bun";
import { join } from "path";
import { stat, rm } from "fs/promises";
import { getCacheDir } from "../utils";
import { CodebaseSource } from "./codebase";
import type { Source, SourceFile, SourceOptions } from "./types";

const REPOS_DIR = join(getCacheDir(), "repos");
const UPDATE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface GitHubInfo {
  owner: string;
  repo: string;
  branch?: string;
}

/**
 * Parse a GitHub URL into its components
 */
function parseGitHubUrl(url: string): GitHubInfo {
  // Handle various GitHub URL formats:
  // https://github.com/owner/repo
  // https://github.com/owner/repo.git
  // https://github.com/owner/repo/tree/branch
  // github.com/owner/repo
  // git@github.com:owner/repo.git

  let normalized = url.trim();

  // Handle SSH format
  if (normalized.startsWith("git@github.com:")) {
    normalized = normalized.replace("git@github.com:", "https://github.com/");
  }

  // Add https if missing
  if (!normalized.startsWith("http")) {
    normalized = `https://${normalized}`;
  }

  // Remove .git suffix
  normalized = normalized.replace(/\.git$/, "");

  try {
    const urlObj = new URL(normalized);
    const parts = urlObj.pathname.split("/").filter(Boolean);

    if (parts.length < 2) {
      throw new Error(`Invalid GitHub URL: ${url}`);
    }

    const owner = parts[0];
    const repo = parts[1];
    let branch: string | undefined;

    // Check for /tree/branch pattern
    if (parts[2] === "tree" && parts[3]) {
      branch = parts[3];
    }

    return { owner, repo, branch };
  } catch (err) {
    throw new Error(`Failed to parse GitHub URL: ${url}`);
  }
}

export class GitHubSource implements Source {
  readonly rootPath: string;
  private url: string;
  private info: GitHubInfo;
  private options: SourceOptions;

  constructor(url: string, options: SourceOptions = {}) {
    this.url = url;
    this.info = parseGitHubUrl(url);
    this.rootPath = join(REPOS_DIR, this.info.owner, this.info.repo);
    this.options = options;
  }

  /**
   * Check if the cached repo needs updating
   */
  private async needsUpdate(): Promise<boolean> {
    try {
      const gitDir = join(this.rootPath, ".git");
      const gitStat = await stat(gitDir);

      // Check if last update was within TTL
      const age = Date.now() - gitStat.mtimeMs;
      return age > UPDATE_TTL_MS;
    } catch {
      // Repo doesn't exist, needs cloning
      return true;
    }
  }

  /**
   * Clone or update the repository
   */
  async prepare(): Promise<void> {
    const needsUpdate = await this.needsUpdate();

    if (!needsUpdate) {
      return;
    }

    try {
      // Check if repo exists
      await stat(join(this.rootPath, ".git"));

      // Repo exists, pull latest
      await $`git -C ${this.rootPath} fetch --depth 1`.quiet();
      await $`git -C ${this.rootPath} reset --hard origin/HEAD`.quiet();
    } catch {
      // Repo doesn't exist, clone it
      const cloneUrl = `https://github.com/${this.info.owner}/${this.info.repo}.git`;

      // Ensure parent directory exists
      await $`mkdir -p ${join(REPOS_DIR, this.info.owner)}`.quiet();

      // Clone with depth 1 for speed
      if (this.info.branch) {
        await $`git clone --depth 1 --branch ${this.info.branch} ${cloneUrl} ${this.rootPath}`.quiet();
      } else {
        await $`git clone --depth 1 ${cloneUrl} ${this.rootPath}`.quiet();
      }
    }
  }

  async *discover(): AsyncGenerator<SourceFile> {
    // Ensure repo is cloned/updated
    await this.prepare();

    // Delegate to CodebaseSource
    const codebase = new CodebaseSource(this.rootPath, this.options);
    yield* codebase.discover();
  }

  async cleanup(): Promise<void> {
    // Optionally remove the cloned repo
    // For now, we keep it cached
  }
}

/**
 * Check if a path is a GitHub URL
 */
export function isGitHubUrl(path: string): boolean {
  return (
    path.includes("github.com") ||
    path.startsWith("git@github.com:") ||
    path.match(/^[\w-]+\/[\w-]+$/) !== null // owner/repo format
  );
}

/**
 * Create appropriate source based on path
 */
export function createSource(path: string, options: SourceOptions = {}): Source {
  if (isGitHubUrl(path)) {
    return new GitHubSource(path, options);
  }
  return new CodebaseSource(path, options);
}
