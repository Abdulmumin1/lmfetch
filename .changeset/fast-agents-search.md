---
"lmfetch": minor
---

Rework lmfetch around search-first code retrieval for faster agent workflows.

- Add `search`, `find-files`, and `read-code` CLI/API surfaces.
- Prefer the optional FFF native search provider when available, with ripgrep fallback.
- Build contexts from ranked search candidates and line-neighborhood windows before falling back to broad scans.
- Add a TypeScript MCP server (`lmfetch-mcp`) exposing `search_code`, `find_files`, `read_code`, and `fetch_context` tools.
- Improve search resilience with broadened multi-term fallback queries and lower ranking for research, generated, and lockfile paths.
