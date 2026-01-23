/**
 * File importance scoring heuristics
 */
import type { SourceFile } from "../sources/types";
import { basename, dirname } from "path";

// Entry point patterns (high importance)
const ENTRY_POINTS = new Set([
  "index.ts",
  "index.js",
  "index.tsx",
  "index.jsx",
  "main.ts",
  "main.js",
  "main.py",
  "mod.rs",
  "lib.rs",
  "main.rs",
  "main.go",
  "app.ts",
  "app.js",
  "app.py",
  "server.ts",
  "server.js",
  "cli.ts",
  "cli.js",
  "cli.py",
  "__init__.py",
  "setup.py",
  "package.json",
  "Cargo.toml",
  "go.mod",
]);

// Important directories (higher importance)
const IMPORTANT_DIRS = new Set([
  "src",
  "lib",
  "core",
  "api",
  "routes",
  "controllers",
  "services",
  "models",
  "components",
  "hooks",
  "utils",
  "helpers",
]);

// Less important directories (lower importance)
const LOW_IMPORTANCE_DIRS = new Set([
  "test",
  "tests",
  "__tests__",
  "spec",
  "specs",
  "e2e",
  "fixtures",
  "mocks",
  "stubs",
  "examples",
  "docs",
  "scripts",
  "tools",
  "config",
  "configs",
]);

// Less important file patterns
const LOW_IMPORTANCE_PATTERNS = [
  /\.test\./,
  /\.spec\./,
  /_test\./,
  /_spec\./,
  /\.d\.ts$/,
  /\.config\./,
  /\.mock\./,
];

export interface ImportanceScores {
  /** Map from file path to importance score (0-1) */
  scores: Map<string, number>;
}

/**
 * Calculate importance scores for all files
 */
export function calculateImportance(files: SourceFile[]): Map<string, number> {
  const scores = new Map<string, number>();

  for (const file of files) {
    const score = calculateFileImportance(file);
    scores.set(file.path, score);
    // Also store by relative path for easier lookup
    scores.set(file.relativePath, score);
  }

  return scores;
}

/**
 * Calculate importance score for a single file
 */
function calculateFileImportance(file: SourceFile): number {
  let score = 0.5; // Base score

  const fileName = basename(file.relativePath);
  const dirPath = dirname(file.relativePath);
  const dirs = dirPath.split("/").filter(Boolean);

  // Entry point bonus
  if (ENTRY_POINTS.has(fileName)) {
    score += 0.3;
  }

  // Important directory bonus
  for (const dir of dirs) {
    if (IMPORTANT_DIRS.has(dir)) {
      score += 0.1;
      break;
    }
  }

  // Low importance directory penalty
  for (const dir of dirs) {
    if (LOW_IMPORTANCE_DIRS.has(dir)) {
      score -= 0.2;
      break;
    }
  }

  // Low importance pattern penalty
  for (const pattern of LOW_IMPORTANCE_PATTERNS) {
    if (pattern.test(file.relativePath)) {
      score -= 0.15;
      break;
    }
  }

  // Depth penalty (deeper files are usually less important)
  const depth = dirs.length;
  if (depth > 3) {
    score -= (depth - 3) * 0.05;
  }

  // Root-level files bonus
  if (depth === 0) {
    score += 0.1;
  }

  // Language-based adjustments
  if (file.language === "markdown" || file.language === "mdx") {
    score -= 0.1;
  }
  if (file.language === "json" || file.language === "yaml") {
    score -= 0.05;
  }

  // Clamp to 0-1 range
  return Math.max(0, Math.min(1, score));
}

/**
 * Combine importance scores with centrality scores
 */
export function combineScores(
  importance: Map<string, number>,
  centrality: Map<string, number>,
  importanceWeight: number = 0.6
): Map<string, number> {
  const combined = new Map<string, number>();
  const centralityWeight = 1 - importanceWeight;

  // Get all unique paths
  const allPaths = new Set([...importance.keys(), ...centrality.keys()]);

  for (const path of allPaths) {
    const impScore = importance.get(path) ?? 0.5;
    const centScore = centrality.get(path) ?? 0.5;

    combined.set(path, impScore * importanceWeight + centScore * centralityWeight);
  }

  return combined;
}
