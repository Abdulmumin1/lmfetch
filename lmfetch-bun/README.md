# lmfetch-bun

Lightning-fast code context fetcher for LLMs - Bun.js implementation.

## Why Bun?

The Python/PyInstaller version suffered from ~30s startup time on macOS due to Gatekeeper code signing verification. This Bun.js implementation achieves:

- **~0.25s startup time** (vs 30s with PyInstaller)
- **65MB binary size** (comparable to PyInstaller)
- Native SQLite caching via `bun:sqlite`
- TypeScript-native with no transpilation
- Beautiful terminal output with syntax-highlighted code blocks

## Features

### Beautiful Terminal Rendering
- 🎨 Syntax-highlighted code blocks with language-specific coloring
- 📦 Bordered code boxes for better readability
- 🎯 Colored headings (magenta → yellow → green → cyan)
- 📝 Formatted lists with colored bullets
- ✨ Inline code, bold, italic, and link styling

### Smart .gitignore Handling
- Follows ALL .gitignore files (root + nested)
- Respects nested gitignore rules with correct path context
- Automatically skips common build/cache directories

## Installation

```bash
# Install globally from npm
npm install -g lmfetch

# Or use with bun
bun install -g lmfetch

# Or from source
git clone https://github.com/Abdulmumin1/lmfetch.git
cd lmfetch
bun install
bun run build

# The binary will be at dist/lmfetch
```

## Using as a Library

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
  semantic: false,  // Use keyword-only ranking (default)
});
console.log(context);

// Advanced usage with ContextBuilder
const builder = new ContextBuilder({
  path: ".",
  query: "API implementation",
  budget: "100k",
  fast: true,  // Keyword-only ranking
  onProgress: (msg) => console.log(msg),
});

const result = await builder.build();
console.log(`Context: ${result.context}`);
console.log(`Tokens: ${result.tokens}`);
console.log(`Files processed: ${result.filesProcessed}`);
```

## Usage

```bash
# Basic usage
lmfetch <path> <query>

# Local codebase
lmfetch . "how does authentication work"

# GitHub repository
lmfetch https://github.com/vercel/ai "explain tool calling"

# Set token budget
lmfetch . "query" -b 100k

# Output context to file
lmfetch . "database models" -o context.md

# Context only (no LLM query)
lmfetch . "API routes" -c

# Enable semantic (embedding) ranking
lmfetch . "query" -s
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

## Ranking Modes

### Default: Keyword Ranking (Fast)
- Uses intelligent keyword matching with stemming
- Filters stopwords and boosts important terms
- Works offline, no API key needed for ranking
- Penalizes test files, fixtures, and codemods
- **Recommended for most queries**

### Semantic Ranking (`-s`)
- Uses embedding similarity with HyDE (Hypothetical Document Embeddings)
- Requires `GOOGLE_GENERATIVE_AI_API_KEY` for embeddings
- Slower but may be more accurate for vague queries
- Combines keyword + embedding + importance signals

## Environment Variables

- `GOOGLE_GENERATIVE_AI_API_KEY` - For Google Gemini models and semantic ranking
- `OPENAI_API_KEY` - For OpenAI models (optional)
- `ANTHROPIC_API_KEY` - For Claude models (optional)

## Building for Multiple Platforms

```bash
# Build all platforms
bun run build:all

# Individual platforms
bun run build:linux-x64
bun run build:linux-arm64
bun run build:darwin-x64
bun run build:darwin-arm64
bun run build:windows-x64
```

## Architecture

```
src/
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

## Development

```bash
# Run in development
bun run dev <path> <query>

# Type check
bun run tsc --noEmit
```
