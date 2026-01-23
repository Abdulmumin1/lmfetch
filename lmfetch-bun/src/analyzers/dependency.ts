/**
 * Dependency graph builder for analyzing import relationships
 */
import type { SourceFile } from "../sources/types";
import { dirname, join, relative, resolve } from "path";

// Import patterns for various languages
const IMPORT_PATTERNS: Record<string, RegExp[]> = {
  python: [
    /^from\s+([\w.]+)\s+import/gm,
    /^import\s+([\w.]+)/gm,
  ],

  javascript: [
    /import\s+.*?\s+from\s+['"]([^'"]+)['"]/gm,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/gm,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/gm,
  ],

  typescript: [
    /import\s+.*?\s+from\s+['"]([^'"]+)['"]/gm,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/gm,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/gm,
  ],

  go: [
    /import\s+["']([^"']+)["']/gm,
    /import\s+\([^)]*["']([^"']+)["']/gm,
  ],

  rust: [
    /use\s+([\w:]+)/gm,
    /mod\s+(\w+)/gm,
  ],

  ruby: [
    /require\s+['"]([^'"]+)['"]/gm,
    /require_relative\s+['"]([^'"]+)['"]/gm,
  ],
};

// Aliases for similar languages
IMPORT_PATTERNS.tsx = IMPORT_PATTERNS.typescript;
IMPORT_PATTERNS.jsx = IMPORT_PATTERNS.javascript;
IMPORT_PATTERNS.mjs = IMPORT_PATTERNS.javascript;
IMPORT_PATTERNS.cjs = IMPORT_PATTERNS.javascript;

export interface DependencyGraph {
  /** Map from file path to list of imported file paths */
  imports: Map<string, string[]>;
  /** Map from file path to list of files that import it */
  importedBy: Map<string, string[]>;
}

/**
 * Build a dependency graph from source files
 */
export function buildDependencyGraph(
  files: SourceFile[],
  rootPath: string
): DependencyGraph {
  const imports = new Map<string, string[]>();
  const importedBy = new Map<string, string[]>();

  // Create a set of all file paths for quick lookup
  const filePaths = new Set(files.map((f) => f.relativePath));

  for (const file of files) {
    const patterns = IMPORT_PATTERNS[file.language];
    if (!patterns) continue;

    const fileImports: string[] = [];

    for (const pattern of patterns) {
      // Reset lastIndex for global regexes
      pattern.lastIndex = 0;

      let match;
      while ((match = pattern.exec(file.content)) !== null) {
        const importPath = match[1];

        // Try to resolve the import to a file in the project
        const resolved = resolveImport(
          importPath,
          file.relativePath,
          filePaths,
          file.language
        );

        if (resolved) {
          fileImports.push(resolved);

          // Update importedBy
          const existing = importedBy.get(resolved) || [];
          existing.push(file.relativePath);
          importedBy.set(resolved, existing);
        }
      }
    }

    imports.set(file.relativePath, fileImports);
  }

  return { imports, importedBy };
}

/**
 * Try to resolve an import path to a project file
 */
function resolveImport(
  importPath: string,
  fromFile: string,
  filePaths: Set<string>,
  language: string
): string | null {
  // Skip external packages (node_modules, etc.)
  if (!importPath.startsWith(".") && !importPath.startsWith("/")) {
    // Could be a package, not a local file
    return null;
  }

  const fromDir = dirname(fromFile);

  // Common extensions to try
  const extensions: string[] = [];
  if (language === "typescript" || language === "tsx") {
    extensions.push(".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx");
  } else if (language === "javascript" || language === "jsx") {
    extensions.push(".js", ".jsx", ".ts", ".tsx", "/index.js", "/index.jsx");
  } else if (language === "python") {
    extensions.push(".py", "/__init__.py");
  } else {
    extensions.push("");
  }

  // Try to find the file
  for (const ext of extensions) {
    const candidate = join(fromDir, importPath + ext);
    const normalized = relative(".", candidate);

    if (filePaths.has(normalized)) {
      return normalized;
    }
  }

  return null;
}

/**
 * Get related files based on dependency graph
 */
export function getRelatedFiles(
  filePath: string,
  graph: DependencyGraph,
  depth: number = 1
): Set<string> {
  const related = new Set<string>();
  const queue: { path: string; d: number }[] = [{ path: filePath, d: 0 }];

  while (queue.length > 0) {
    const { path, d } = queue.shift()!;

    if (d > depth) continue;
    if (related.has(path)) continue;

    related.add(path);

    // Add imports
    const imports = graph.imports.get(path) || [];
    for (const imp of imports) {
      if (!related.has(imp)) {
        queue.push({ path: imp, d: d + 1 });
      }
    }

    // Add files that import this one
    const importers = graph.importedBy.get(path) || [];
    for (const imp of importers) {
      if (!related.has(imp)) {
        queue.push({ path: imp, d: d + 1 });
      }
    }
  }

  return related;
}

/**
 * Calculate centrality scores (simplified PageRank-like)
 */
export function calculateCentrality(graph: DependencyGraph): Map<string, number> {
  const scores = new Map<string, number>();

  // Initialize all files with base score
  for (const path of graph.imports.keys()) {
    scores.set(path, 1.0);
  }

  // Iterative update (simplified PageRank)
  const dampingFactor = 0.85;
  const iterations = 10;

  for (let i = 0; i < iterations; i++) {
    const newScores = new Map<string, number>();

    for (const [path, _] of scores) {
      let score = 1 - dampingFactor;

      // Add scores from files that import this one
      const importers = graph.importedBy.get(path) || [];
      for (const importer of importers) {
        const importerScore = scores.get(importer) || 1;
        const importerOutDegree = graph.imports.get(importer)?.length || 1;
        score += (dampingFactor * importerScore) / importerOutDegree;
      }

      newScores.set(path, score);
    }

    // Update scores
    for (const [path, score] of newScores) {
      scores.set(path, score);
    }
  }

  // Normalize to 0-1 range
  const maxScore = Math.max(...scores.values());
  if (maxScore > 0) {
    for (const [path, score] of scores) {
      scores.set(path, score / maxScore);
    }
  }

  return scores;
}
