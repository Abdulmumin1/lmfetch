# lmfetch-bun: Implementation Plan

## Status: ✅ IMPLEMENTED

### Performance Results
| Metric | Python/PyInstaller | Bun.js |
|--------|-------------------|--------|
| **Startup time** | ~30s (macOS Gatekeeper) | **~0.25s** |
| Binary size | ~50MB | 65MB |

### Changes Made (v0.1.0)

The current Python/PyInstaller build suffers from ~30s startup time on macOS due to Gatekeeper code signing verification. Bun.js offers:

- **Near-instant startup** (~50ms) with native compilation
- **No Gatekeeper delays** - Bun compiles to proper native binaries
- **Built-in SQLite** - Native `bun:sqlite` module
- **TypeScript-native** - No transpilation overhead
- **Single binary** - `bun build --compile` produces standalone executables

---

## Architecture Overview

```
lmfetch-bun/
├── src/
│   ├── index.ts              # Entry point
│   ├── cli.ts                # CLI argument parsing
│   ├── builder.ts            # Main orchestrator (ContextBuilder)
│   ├── cache.ts              # SQLite caching (bun:sqlite)
│   ├── tokens.ts             # Token counting
│   ├── utils.ts              # Retry decorator, helpers
│   │
│   ├── sources/              # Data source adapters
│   │   ├── types.ts          # Source interface
│   │   ├── codebase.ts       # Local directory scanner
│   │   └── github.ts         # GitHub repository cloner
│   │
│   ├── chunkers/             # Code splitting
│   │   ├── types.ts          # Chunk types
│   │   └── code.ts           # AST-heuristic regex chunker
│   │
│   ├── rankers/              # Relevance scoring
│   │   ├── types.ts          # Ranker interface, ScoredChunk
│   │   ├── keyword.ts        # BM25-like keyword matching
│   │   ├── embedding.ts      # Semantic vector similarity
│   │   └── hybrid.ts         # Combined ranker
│   │
│   └── analyzers/            # Code analysis
│       ├── dependency.ts     # Import/dependency graph
│       ├── importance.ts     # File importance heuristics
│       └── llm.ts            # LLM-powered reranking
│
├── bin/
│   └── lmfetch.ts            # CLI entry (for bun build --compile)
│
├── package.json
├── tsconfig.json
├── bunfig.toml
└── README.md
```

---

## Phase 1: Core Infrastructure

### 1.1 Project Setup

```bash
mkdir lmfetch-bun && cd lmfetch-bun
bun init
```

**package.json:**
```json
{
  "name": "lmfetch",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "lmfetch": "./bin/lmfetch.ts"
  },
  "scripts": {
    "dev": "bun run src/index.ts",
    "build": "bun build --compile --minify --target=bun bin/lmfetch.ts --outfile=dist/lmfetch",
    "build:all": "bun run scripts/build-all.ts"
  }
}
```

**Dependencies:**
```bash
# Core
bun add commander            # CLI framework (lighter than yargs)
bun add chalk                # Terminal colors
bun add ora                  # Spinners
bun add cli-table3           # Table output
bun add glob                 # File globbing (or use Bun.Glob)
bun add ignore               # .gitignore parsing

# LLM & AI
bun add openai               # OpenAI SDK
bun add @google/generative-ai # Google Gemini SDK
bun add @anthropic-ai/sdk    # Anthropic SDK

# Tokenization
bun add js-tiktoken          # Token counting (cl100k_base)

# Dev
bun add -d typescript @types/bun
```

### 1.2 Cache System (cache.ts)

Leverage Bun's native SQLite:

```typescript
import { Database } from "bun:sqlite";
import { homedir } from "os";
import { join } from "path";

const CACHE_DIR = join(homedir(), ".cache", "lmfetch");
const DB_PATH = join(CACHE_DIR, "cache.db");

export class Cache {
  private db: Database;

  constructor() {
    this.db = new Database(DB_PATH, { create: true });
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY,
        hash TEXT NOT NULL,
        mtime REAL NOT NULL,
        size INTEGER NOT NULL,
        last_accessed REAL NOT NULL,
        language TEXT
      );

      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL,
        content TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        chunk_type TEXT,
        name TEXT,
        FOREIGN KEY (file_path) REFERENCES files(path)
      );

      CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_path);
    `);
  }

  // ... methods for get/set chunks, files, pruning
}
```

### 1.3 Token Counting (tokens.ts)

```typescript
import { encodingForModel } from "js-tiktoken";

const encoder = encodingForModel("gpt-4o");

export function countTokens(text: string): number {
  return encoder.encode(text).length;
}

export function parseBudget(budget: string): number {
  const match = budget.match(/^(\d+(?:\.\d+)?)(k|m)?$/i);
  if (!match) throw new Error(`Invalid budget: ${budget}`);

  const [, num, suffix] = match;
  const value = parseFloat(num);

  switch (suffix?.toLowerCase()) {
    case "k": return Math.floor(value * 1_000);
    case "m": return Math.floor(value * 1_000_000);
    default: return Math.floor(value);
  }
}
```

### 1.4 Utility Functions (utils.ts)

```typescript
// Retry decorator with exponential backoff
export function retry<T>(
  fn: () => Promise<T>,
  options: { retries?: number; delay?: number; backoff?: number } = {}
): Promise<T> {
  const { retries = 3, delay = 1000, backoff = 2 } = options;

  return new Promise(async (resolve, reject) => {
    let lastError: Error;

    for (let i = 0; i <= retries; i++) {
      try {
        return resolve(await fn());
      } catch (err) {
        lastError = err as Error;
        if (i < retries) {
          await Bun.sleep(delay * Math.pow(backoff, i));
        }
      }
    }

    reject(lastError!);
  });
}

// SHA256 hash for cache keys
export async function hashContent(content: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(content);
  return hasher.digest("hex");
}
```

---

## Phase 2: Source Adapters

### 2.1 Source Interface (sources/types.ts)

```typescript
export interface SourceFile {
  path: string;
  relativePath: string;
  content: string;
  language: string;
  size: number;
  mtime: number;
}

export interface Source {
  discover(): AsyncGenerator<SourceFile>;
  cleanup?(): Promise<void>;
}
```

### 2.2 Local Codebase (sources/codebase.ts)

```typescript
import { Glob } from "bun";
import ignore from "ignore";

export class CodebaseSource implements Source {
  private ig: ReturnType<typeof ignore>;

  constructor(
    private rootPath: string,
    private includes: string[],
    private excludes: string[]
  ) {
    this.ig = ignore();
    this.loadGitignore();
  }

  async *discover(): AsyncGenerator<SourceFile> {
    const glob = new Glob("**/*");

    for await (const path of glob.scan({
      cwd: this.rootPath,
      absolute: true,
      onlyFiles: true,
    })) {
      if (this.shouldInclude(path)) {
        const content = await Bun.file(path).text();
        yield {
          path,
          relativePath: path.slice(this.rootPath.length + 1),
          content,
          language: detectLanguage(path),
          size: content.length,
          mtime: (await Bun.file(path).stat()).mtime.getTime(),
        };
      }
    }
  }
}
```

### 2.3 GitHub Source (sources/github.ts)

```typescript
import { $ } from "bun";

export class GitHubSource implements Source {
  private localPath: string;

  constructor(private url: string) {
    const { owner, repo } = parseGitHubUrl(url);
    this.localPath = join(CACHE_DIR, "repos", owner, repo);
  }

  async prepare(): Promise<void> {
    if (await this.needsUpdate()) {
      await $`git clone --depth 1 ${this.url} ${this.localPath}`.quiet();
    }
  }

  async *discover(): AsyncGenerator<SourceFile> {
    // Delegate to CodebaseSource
    const codebase = new CodebaseSource(this.localPath, [], []);
    yield* codebase.discover();
  }
}
```

---

## Phase 3: Chunking System

### 3.1 Chunk Types (chunkers/types.ts)

```typescript
export interface Chunk {
  id: string;
  filePath: string;
  relativePath: string;
  content: string;
  startLine: number;
  endLine: number;
  type: "function" | "class" | "method" | "section" | "module";
  name?: string;
  language: string;
  tokens: number;
}
```

### 3.2 Code Chunker (chunkers/code.ts)

Port the regex patterns from Python:

```typescript
const PATTERNS: Record<string, RegExp[]> = {
  python: [
    /^(?:async\s+)?def\s+(\w+)/m,
    /^class\s+(\w+)/m,
  ],
  typescript: [
    /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/m,
    /^(?:export\s+)?class\s+(\w+)/m,
    /^(?:export\s+)?(?:const|let)\s+(\w+)\s*=/m,
    /^(?:export\s+)?interface\s+(\w+)/m,
    /^(?:export\s+)?type\s+(\w+)/m,
  ],
  // ... other languages
};

export class CodeChunker {
  private maxLines = 200;
  private minLines = 10;

  chunk(file: SourceFile): Chunk[] {
    const patterns = PATTERNS[file.language] || [];
    const lines = file.content.split("\n");

    // Find all definition boundaries
    const boundaries = this.findBoundaries(lines, patterns);

    // Create chunks from boundaries
    return this.createChunks(file, lines, boundaries);
  }
}
```

---

## Phase 4: Ranking System

### 4.1 Keyword Ranker (rankers/keyword.ts)

BM25-inspired scoring:

```typescript
export class KeywordRanker {
  private tokenize(text: string): string[] {
    // Split on camelCase, snake_case, and common delimiters
    return text
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[_-]/g, " ")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
  }

  score(chunk: Chunk, queryTokens: string[]): number {
    const contentTokens = this.tokenize(chunk.content);
    const pathTokens = this.tokenize(chunk.relativePath);
    const nameTokens = chunk.name ? this.tokenize(chunk.name) : [];

    let score = 0;

    for (const qt of queryTokens) {
      // Content matches
      score += contentTokens.filter(t => t.includes(qt)).length * 1.0;
      // Path bonus
      score += pathTokens.filter(t => t.includes(qt)).length * 2.0;
      // Name bonus
      score += nameTokens.filter(t => t.includes(qt)).length * 3.0;
    }

    return score;
  }
}
```

### 4.2 Embedding Ranker (rankers/embedding.ts)

```typescript
import { GoogleGenerativeAI } from "@google/generative-ai";

export class EmbeddingRanker {
  private genAI: GoogleGenerativeAI;
  private model: any;
  private cache: Map<string, number[]> = new Map();

  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
    this.model = this.genAI.getGenerativeModel({ model: "text-embedding-004" });
  }

  async embed(texts: string[]): Promise<number[][]> {
    const result = await this.model.batchEmbedContents({
      requests: texts.map(text => ({ content: { parts: [{ text }] } })),
    });
    return result.embeddings.map((e: any) => e.values);
  }

  cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
```

### 4.3 Hybrid Ranker (rankers/hybrid.ts)

```typescript
export class HybridRanker {
  private keywordRanker: KeywordRanker;
  private embeddingRanker: EmbeddingRanker;

  // Weights
  private readonly KEYWORD_WEIGHT = 0.4;
  private readonly EMBEDDING_WEIGHT = 0.4;
  private readonly IMPORTANCE_WEIGHT = 0.2;

  async rank(
    chunks: Chunk[],
    query: string,
    importanceScores: Map<string, number>
  ): Promise<ScoredChunk[]> {
    // 1. Keyword scores
    const queryTokens = this.tokenize(query);
    const keywordScores = chunks.map(c => this.keywordRanker.score(c, queryTokens));

    // 2. Embedding scores (with HyDE)
    const hydeDoc = await this.generateHyDE(query);
    const queryEmbedding = await this.embeddingRanker.embed([hydeDoc]);
    const chunkEmbeddings = await this.embeddingRanker.embed(
      chunks.map(c => c.content.slice(0, 8000))
    );
    const embeddingScores = chunkEmbeddings.map(
      e => this.embeddingRanker.cosineSimilarity(queryEmbedding[0], e)
    );

    // 3. Combine scores
    return chunks.map((chunk, i) => ({
      chunk,
      score:
        this.normalize(keywordScores)[i] * this.KEYWORD_WEIGHT +
        embeddingScores[i] * this.EMBEDDING_WEIGHT +
        (importanceScores.get(chunk.filePath) ?? 0) * this.IMPORTANCE_WEIGHT,
    })).sort((a, b) => b.score - a.score);
  }
}
```

---

## Phase 5: LLM Integration

### 5.1 Unified LLM Client (llm/client.ts)

```typescript
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";

type Provider = "openai" | "anthropic" | "google";

export class LLMClient {
  private openai?: OpenAI;
  private anthropic?: Anthropic;
  private google?: GoogleGenerativeAI;

  async generateText(options: {
    model: string;
    prompt: string;
    system?: string;
  }): Promise<string> {
    const provider = this.detectProvider(options.model);

    switch (provider) {
      case "openai":
        return this.generateOpenAI(options);
      case "anthropic":
        return this.generateAnthropic(options);
      case "google":
        return this.generateGoogle(options);
    }
  }

  private detectProvider(model: string): Provider {
    if (model.startsWith("gpt") || model.startsWith("o1")) return "openai";
    if (model.startsWith("claude")) return "anthropic";
    return "google"; // Default to Gemini
  }
}
```

---

## Phase 6: CLI Interface

### 6.1 Main CLI (cli.ts)

```typescript
import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";

const program = new Command();

program
  .name("lmfetch")
  .description("Fetch intelligent code context for LLMs")
  .version("0.1.0")
  .argument("<path>", "Local path or GitHub URL")
  .argument("<query>", "Natural language query")
  .option("-b, --budget <budget>", "Token budget", "50k")
  .option("-o, --output <file>", "Write context to file")
  .option("-c, --context", "Output context only, skip LLM query")
  .option("-i, --include <patterns...>", "Include patterns")
  .option("-e, --exclude <patterns...>", "Exclude patterns")
  .option("-m, --model <model>", "LLM model", "gemini-2.0-flash")
  .option("-f, --fast", "Skip smart reranking")
  .option("--clean-cache", "Clear the cache")
  .option("--force-large", "Process large files")
  .action(async (path, query, options) => {
    const spinner = ora("Initializing...").start();

    try {
      const builder = new ContextBuilder({
        path,
        query,
        budget: parseBudget(options.budget),
        includes: options.include || [],
        excludes: options.exclude || [],
        fast: options.fast,
        forceLarge: options.forceLarge,
        onProgress: (msg) => spinner.text = msg,
      });

      const context = await builder.build();
      spinner.stop();

      if (options.context) {
        console.log(context);
      } else {
        // Query LLM with context
        const answer = await queryLLM(context, query, options.model);
        console.log(answer);
      }
    } catch (err) {
      spinner.fail(chalk.red((err as Error).message));
      process.exit(1);
    }
  });

program.parse();
```

---

## Phase 7: Build & Distribution

### 7.1 Multi-Platform Build Script

```typescript
// scripts/build-all.ts
import { $ } from "bun";

const targets = [
  { target: "bun-linux-x64", output: "lmfetch-linux-x64" },
  { target: "bun-linux-arm64", output: "lmfetch-linux-arm64" },
  { target: "bun-darwin-x64", output: "lmfetch-darwin-x64" },
  { target: "bun-darwin-arm64", output: "lmfetch-darwin-arm64" },
  { target: "bun-windows-x64", output: "lmfetch-windows-x64.exe" },
];

for (const { target, output } of targets) {
  console.log(`Building for ${target}...`);
  await $`bun build --compile --minify --target=${target} bin/lmfetch.ts --outfile=dist/${output}`;
}
```

### 7.2 GitHub Actions Workflow

```yaml
name: Release

on:
  push:
    tags: ["v*"]

jobs:
  build:
    strategy:
      matrix:
        include:
          - os: ubuntu-latest
            target: bun-linux-x64
            artifact: lmfetch-linux-x64
          - os: ubuntu-latest
            target: bun-linux-arm64
            artifact: lmfetch-linux-arm64
          - os: macos-latest
            target: bun-darwin-x64
            artifact: lmfetch-darwin-x64
          - os: macos-latest
            target: bun-darwin-arm64
            artifact: lmfetch-darwin-arm64
          - os: windows-latest
            target: bun-windows-x64
            artifact: lmfetch-windows-x64.exe

    runs-on: ${{ matrix.os }}

    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1

      - run: bun install
      - run: bun build --compile --minify --target=${{ matrix.target }} bin/lmfetch.ts --outfile=${{ matrix.artifact }}

      - uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.artifact }}
          path: ${{ matrix.artifact }}

  release:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
      - uses: softprops/action-gh-release@v1
        with:
          files: |
            lmfetch-linux-x64/lmfetch-linux-x64
            lmfetch-linux-arm64/lmfetch-linux-arm64
            lmfetch-darwin-x64/lmfetch-darwin-x64
            lmfetch-darwin-arm64/lmfetch-darwin-arm64
            lmfetch-windows-x64.exe/lmfetch-windows-x64.exe
```

---

## Implementation Timeline

### Week 1: Foundation
- [ ] Project setup with Bun
- [ ] Cache system (SQLite)
- [ ] Token counting
- [ ] Utility functions
- [ ] Source adapters (local + GitHub)

### Week 2: Core Pipeline
- [ ] Code chunker with language patterns
- [ ] Keyword ranker (BM25)
- [ ] Embedding ranker (Google)
- [ ] Hybrid ranker with HyDE

### Week 3: LLM & CLI
- [ ] Unified LLM client (OpenAI, Anthropic, Google)
- [ ] CLI with Commander
- [ ] Progress reporting (ora)
- [ ] Output formatting

### Week 4: Polish & Release
- [ ] Multi-platform builds
- [ ] GitHub Actions CI/CD
- [ ] Install script
- [ ] Documentation
- [ ] Testing

---

## Key Advantages of Bun.js Port

| Aspect | Python/PyInstaller | Bun.js |
|--------|-------------------|--------|
| Startup time | ~30s (macOS Gatekeeper) | ~50ms |
| Binary size | ~50MB | ~50MB (comparable) |
| SQLite | External library | Native `bun:sqlite` |
| File I/O | asyncio + aiofiles | Native async |
| HTTP | aiohttp/httpx | Native fetch |
| Shell commands | subprocess | Native `$` shell |
| TypeScript | N/A | Native, no transpile |
| Build | PyInstaller (slow) | `bun build` (fast) |

---

## Migration Checklist

- [x] Analyze Python codebase structure
- [ ] Set up Bun project
- [ ] Port cache.py → cache.ts
- [ ] Port tokens.py → tokens.ts
- [ ] Port utils.py → utils.ts
- [ ] Port sources/codebase.py → sources/codebase.ts
- [ ] Port sources/github.py → sources/github.ts
- [ ] Port chunkers/code.py → chunkers/code.ts
- [ ] Port rankers/keyword.py → rankers/keyword.ts
- [ ] Port rankers/embedding.py → rankers/embedding.ts
- [ ] Port rankers/hybrid.py → rankers/hybrid.ts
- [ ] Port analyzers/__init__.py → analyzers/dependency.ts
- [ ] Port analyzers/importance.py → analyzers/importance.ts
- [ ] Port analyzers/llm.py → analyzers/llm.ts
- [ ] Port builder.py → builder.ts
- [ ] Port cli.py → cli.ts
- [ ] Port mcp_server.py → mcp-server.ts (optional)
- [ ] Set up multi-platform builds
- [ ] Create GitHub Actions workflow
- [ ] Write install script
- [ ] Test on all platforms
