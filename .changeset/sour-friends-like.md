---
"lmfetch": minor
---

Initial Bun.js release of lmfetch - Lightning-fast code context fetcher for LLMs

## Features

- **~0.25s startup time** vs 30s with PyInstaller
- Smart keyword-based ranking with stopword filtering and stemming
- Optional semantic (embedding) ranking with `-s` flag
- Beautiful terminal UI with yellow theme and star spinner
- Markdown rendering with syntax highlighting and table support
- SQLite caching for fast repeated queries
- Multi-platform binaries (Linux, macOS, Windows - x64 and ARM64)
- Programmatic API for use as a JavaScript library

## Usage

```bash
# CLI usage
lmfetch . "how does authentication work"

# With semantic ranking
lmfetch . "explain the API" -s

# Output to file
lmfetch . "database models" -o context.md
```

## Programmatic API

```typescript
import { ContextBuilder, query } from "lmfetch";

// Quick query
const answer = await query(".", "how does auth work");

// Advanced usage
const builder = new ContextBuilder({
  path: ".",
  query: "authentication flow",
  budget: "100k",
});
const result = await builder.build();
```