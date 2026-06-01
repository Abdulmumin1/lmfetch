# lmfetch-bun: Final UI Improvements

## 0.4.2

### Patch Changes

- c516bbe: Initial Bun.js release of lmfetch - Lightning-fast code context fetcher for LLMs

## 0.4.1

### Patch Changes

- 9e52017: Initial Bun.js release of lmfetch - Lightning-fast code context fetcher for LLMs

## 0.4.0

### Minor Changes

- 757586a: Initial Bun.js release of lmfetch - Lightning-fast code context fetcher for LLMs

## 0.3.0

### Minor Changes

- 54bd30b: Initial Bun.js release of lmfetch - Lightning-fast code context fetcher for LLMs

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

## 0.2.0

### Minor Changes

- 98e1074: Initial Bun.js release of lmfetch - Lightning-fast code context fetcher for LLMs

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

## Changes Made (v0.2.0)

### 🎯 Python-Style UI

**New Output Format:**

```
Query   how does caching work
Files   36/159 [████████████░░░░░░░░] 69%
Tokens  34,999 [██████████████░░░░░░] 70%

gemini-2.0-flash

⠋ Generating answer...

[Answer appears here]
```

### Key Improvements:

1. **Progress Bar**

   - Shows files processed with visual progress bar
   - Format: `Files   X/Y [█████░░░] %`
   - Uses █ for filled, ░ for unfilled
   - Matches Python version exactly

2. **Token Usage Display**

   - Shows tokens used vs budget
   - Visual progress bar showing % of budget used
   - Format: `Tokens  34,999 [████░░░] 70%`

3. **Model Display**

   - Shows which model is being used
   - Appears before generating answer

4. **Spinner During Generation**

   - Shows "Generating answer..." with dots spinner
   - Only appears while waiting for LLM response
   - Automatically stops when answer arrives

5. **Clean, Minimal Output**
   - No complex markdown rendering
   - Just clean text output
   - Raw markdown in non-interactive mode

### Removed:

- ❌ Complex markdown parser (was causing issues)
- ❌ Heavy syntax highlighting (cli-highlight still used for progress bars)
- ❌ Bordered code blocks (too much visual noise)
- ❌ Excessive color coding

### Dependencies:

- Added: `cli-progress` for progress bars
- Removed: `marked`, `marked-terminal` (too complex)
- Kept: `cli-highlight` (for progress bar rendering only)

### Binary Size:

- Now: 63MB
- Before: 65MB
- Saved: 2MB by removing heavy deps

### User Experience:

✅ Clean, professional output like Python version
✅ Clear progress indication
✅ Model name displayed
✅ Loading spinner during generation
✅ No confusing markdown rendering
✅ Works great in both interactive and piped modes

## Output Modes:

### Interactive (TTY):

- Shows query
- Progress bars
- Token usage with bar
- Model name
- Spinner during generation
- Raw answer text

### Non-Interactive (Piped):

- No progress bars
- No spinners
- Just the answer
- Perfect for scripting

## Example Usage:

```bash
# Interactive
lmfetch . "how does auth work"

# Piped (no UI, just answer)
lmfetch . "explain caching" | less

# Context only
lmfetch . "show me routes" -c > context.md

# With budget
lmfetch . "query" -b 100k
```
