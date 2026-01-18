# lmfetch

**Effortlessly turn codebase into context for your LLMs.**

`lmfetch` is a lightning-fast CLI tool that fetches, chunks, supports local files and remote GitHub repositories, and ranks code context. It's designed to fit the most relevant code into your token budget, so your LLM can understand the implementation details without the noise.

## Install

**Mac & Linux**
```bash
curl -fsSL https://raw.githubusercontent.com/Abdulmumin1/lmfetch/main/install.sh | bash
```

**Windows** (PowerShell)
Coming soon.

## Usage

**Fetch local code**
```bash
lmfetch . "how does authentication work"
```

**Fetch from GitHub**
```bash
lmfetch https://github.com/vercel/ai "explain tool calling"
```

**Common Options**
```bash
# Set a token budget (default: 50k)
lmfetch . "query" -b 10k

# Force processing of large files
lmfetch . "query" --force-large

# Clear cache
lmfetch --clean-cache

# Output context to file
lmfetch . "query" -o context.md
```

## How It Works

1.  **Smart Chunking**: Understands AST (classes, functions) for Python, TS, Go, Rust, and more.
2.  **Hybrid Ranking**: Combines keyword matching, vector embeddings, and dependency graph centrality.
3.  **HyDE Reasoning**: Generates hypothetical code to match your *intent*, not just your keywords.
4.  **Privacy**: Runs locally. Embeddings use your own API keys (OpenAI/Google).

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for a deep dive into the pipeline.

## License

MIT
