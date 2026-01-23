/**
 * Utility functions
 */

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: { retries?: number; delay?: number; backoff?: number } = {}
): Promise<T> {
  const { retries = 3, delay = 1000, backoff = 2 } = options;
  let lastError: Error | undefined;

  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;
      if (i < retries) {
        await Bun.sleep(delay * Math.pow(backoff, i));
      }
    }
  }

  throw lastError!;
}

/**
 * SHA256 hash of content
 */
export function hashContent(content: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(content);
  return hasher.digest("hex");
}

/**
 * Check if running in a pipe (not interactive terminal)
 */
export function isPiped(): boolean {
  return !process.stdout.isTTY;
}

/**
 * Normalize an array of scores to 0-1 range
 */
export function normalize(scores: number[]): number[] {
  if (scores.length === 0) return [];

  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min;

  if (range === 0) {
    return scores.map(() => 0.5);
  }

  return scores.map((s) => (s - min) / range);
}

/**
 * Batch an array into chunks of specified size
 */
export function batch<T>(arr: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    batches.push(arr.slice(i, i + size));
  }
  return batches;
}

/**
 * Cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error("Vectors must have the same length");
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dot / magnitude;
}

/**
 * Detect language from file extension
 */
export function detectLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";

  const languageMap: Record<string, string> = {
    // JavaScript/TypeScript
    js: "javascript",
    jsx: "jsx",
    ts: "typescript",
    tsx: "tsx",
    mjs: "javascript",
    cjs: "javascript",

    // Python
    py: "python",
    pyw: "python",
    pyi: "python",

    // Go
    go: "go",

    // Rust
    rs: "rust",

    // Ruby
    rb: "ruby",
    rake: "ruby",

    // PHP
    php: "php",

    // Java/JVM
    java: "java",
    kt: "kotlin",
    kts: "kotlin",
    scala: "scala",

    // C family
    c: "c",
    h: "c",
    cpp: "cpp",
    hpp: "cpp",
    cc: "cpp",
    cxx: "cpp",
    cs: "csharp",
    fs: "fsharp",

    // Swift/Objective-C
    swift: "swift",
    m: "objc",
    mm: "objc",

    // Shell
    sh: "bash",
    bash: "bash",
    zsh: "zsh",

    // Data/Config
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    xml: "xml",

    // Markup
    md: "markdown",
    mdx: "mdx",
    rst: "rst",
    html: "html",
    htm: "html",
    css: "css",
    scss: "scss",
    less: "less",

    // SQL
    sql: "sql",

    // GraphQL
    graphql: "graphql",
    gql: "graphql",

    // Docker/DevOps
    dockerfile: "dockerfile",
    tf: "terraform",

    // Vue/Svelte
    vue: "vue",
    svelte: "svelte",
  };

  return languageMap[ext] || "text";
}

/**
 * Get cache directory path
 */
export function getCacheDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "~";
  return `${home}/.cache/lmfetch`;
}
