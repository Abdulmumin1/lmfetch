# lmfetch

**Effortlessly turn codebase into context for your LLMs.**

`lmfetch` is a lightning-fast CLI tool that fetches, chunks, and ranks code context from local files and remote GitHub repositories. It's designed to fit the most relevant code into your token budget, so your LLM can understand the implementation details without the noise.

## Why lmfetch?

- Lightning Fast
- Keyword matching with stemming, optional semantic embeddings, and dependency analysis
- Use as CLI tool or JavaScript/TypeScript library
- Works with local directories and GitHub repositories

## Install

```bash
curl -fsSL https://lmfetch.ai-query.dev/install.sh | bash
```

### Using npm/bun

```bash
# Install globally from npm
npm install -g lmfetch

# Or with bun
bun install -g lmfetch
```

## Quick Start

### CLI Usage

```bash
# Fetch local code
lmfetch . "how does authentication work"

# Fetch from GitHub
lmfetch https://github.com/vercel/ai "explain tool calling"

# Set token budget
lmfetch . "query" -b 100k

# Output context to file
lmfetch . "database models" -o context.md

# Context only (no LLM query)
lmfetch . "API routes" -c

# Enable semantic (embedding) ranking
lmfetch . "query" -s

# Clear cache
lmfetch --clean-cache
```

### Using as a Library

```bash
npm install lmfetch
# or
bun add lmfetch
```

```typescript
import { ContextBuilder, query, fetchContext } from "lmfetch";

// Quick query with LLM
const answer = await query(".", "how does authentication work", {
  model: "gemini-2.0-flash",
  budget: "100k",
});
console.log(answer);

// Fetch context only
const context = await fetchContext(".", "database models", {
  budget: "50k",
  semantic: false, // Use keyword-only ranking (default)
});
console.log(context);

// Advanced usage with ContextBuilder
const builder = new ContextBuilder({
  path: ".",
  query: "API implementation",
  budget: "100k",
  fast: true, // Keyword-only ranking
  onProgress: (msg) => console.log(msg),
});

const result = await builder.build();
console.log(`Context: ${result.context}`);
console.log(`Tokens: ${result.tokens}`);
console.log(`Files processed: ${result.filesProcessed}`);
```

## Options

```
-b, --budget <budget>        Token budget (e.g., 50k, 100k, 1m) (default: "50k")
-o, --output <file>          Write context to file instead of stdout
-c, --context                Output context only, skip LLM query
-i, --include <patterns...>  Include patterns (glob)
-e, --exclude <patterns...>  Exclude patterns (glob)
-m, --model <model>          LLM model for answering (default: "gemini-2.0-flash")
-s, --semantic               Use semantic (embedding) ranking (slower, requires API key)
--clean-cache                Clear the internal cache
--force-large                Process files larger than 1MB or 20k lines
```

## How It Works

### Smart Chunking

Understands AST (classes, functions) for Python, TypeScript, Go, Rust, and more. Falls back to intelligent heuristics for other languages.

### Ranking Modes

**Default: Keyword Ranking (Fast)**

- Uses intelligent keyword matching with stemming
- Filters stopwords and boosts important terms (e.g., `.methodName`)
- Works offline, no API key needed for ranking
- Penalizes test files, fixtures, and codemods
- **Recommended for most queries**

**Semantic Ranking (`-s`)**

- Uses embedding similarity with HyDE (Hypothetical Document Embeddings)
- Requires `GOOGLE_GENERATIVE_AI_API_KEY` for embeddings
- Slower but may be more accurate for vague queries
- Combines keyword + embedding + importance signals

## Environment Variables

- `GOOGLE_GENERATIVE_AI_API_KEY` - For Google Gemini models and semantic ranking
- `OPENAI_API_KEY` - For OpenAI models (optional)
- `ANTHROPIC_API_KEY` - For Claude models (optional)

## Architecture

### Bun.js Implementation

```
lmfetch-bun/src/
├── cli.ts                # CLI interface (Commander)
├── builder.ts            # Main orchestrator
├── cache.ts              # SQLite caching (bun:sqlite)
├── tokens.ts             # Token counting (js-tiktoken)
├── utils.ts              # Utilities
├── sources/              # Data source adapters
│   ├── codebase.ts       # Local directory scanner
│   └── github.ts         # GitHub repository cloner
├── chunkers/             # Code splitting
│   └── code.ts           # AST-heuristic regex chunker
├── rankers/              # Relevance scoring
│   ├── keyword.ts        # BM25-like keyword matching
│   ├── embedding.ts      # Semantic vector similarity
│   └── hybrid.ts         # Combined ranker with HyDE
├── analyzers/            # Code analysis
│   ├── dependency.ts     # Import/dependency graph
│   ├── importance.ts     # File importance heuristics
│   └── llm.ts            # LLM-powered reranking
└── llm/                  # LLM integration
    └── client.ts         # Unified client (AI SDK)
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for a deep dive into the pipeline.

## Development

### Bun Package

```bash
cd lmfetch-bun

# Install dependencies
bun install

# Run in development
bun run dev <path> <query>

# Type check
bun run tsc --noEmit

# Build binary
bun run build

# Build for all platforms
bun run build:all
```

### Python Package

```bash
# Install with uv
uv sync --all-extras --dev

# Run
uv run lmfetch . "query"

# Build
uv build
```

## Building for Multiple Platforms

```bash
cd lmfetch-bun

# Build all platforms
bun run build:all

# Individual platforms
bun run build:linux-x64
bun run build:linux-arm64
bun run build:darwin-x64
bun run build:darwin-arm64
bun run build:windows-x64
```

Binaries are created in `lmfetch-bun/dist/`.

## Versions

This repository contains two implementations:

- **Bun.js** (`lmfetch-bun/`) - Recommended for best performance
  - ~0.25s startup time
  - Available on npm: `npm install -g lmfetch`
  - Can be used as a JavaScript/TypeScript library

- **Python** (`lmfetch/`) - Original implementation
  - ~30s startup time on macOS
  - Available via uv, or pip (uv run lmfetch)
  - Maintained for compatibility

## License

MIT - see [LICENSE](LICENSE) for details.

## Credits

Built with:

- [AI Query](https://ai-query.dev) - Unified LLM interface (Python)
- [Bun](https://bun.sh) - Fast JavaScript runtime
- [AI SDK](https://sdk.vercel.ai) - Unified LLM interface
- [Commander](https://github.com/tj/commander.js) - CLI framework
- [Marked](https://marked.js.org) - Markdown parser
- [Ora](https://github.com/sindresorhus/ora) - Elegant terminal spinners
