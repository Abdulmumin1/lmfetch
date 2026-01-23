/**
 * AST-heuristic regex-based code chunker
 */
import { countTokens } from "../tokens";
import { hashContent } from "../utils";
import type { Chunk, ChunkType, Chunker } from "./types";

const MAX_CHUNK_LINES = 200;
const MIN_CHUNK_LINES = 10;

interface Pattern {
  regex: RegExp;
  type: ChunkType;
  nameGroup: number;
}

// Language-specific patterns for detecting code boundaries
const PATTERNS: Record<string, Pattern[]> = {
  python: [
    { regex: /^(?:async\s+)?def\s+(\w+)/m, type: "function", nameGroup: 1 },
    { regex: /^class\s+(\w+)/m, type: "class", nameGroup: 1 },
  ],

  javascript: [
    {
      regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/m,
      type: "function",
      nameGroup: 1,
    },
    {
      regex: /^(?:export\s+)?class\s+(\w+)/m,
      type: "class",
      nameGroup: 1,
    },
    {
      regex: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=/m,
      type: "constant",
      nameGroup: 1,
    },
  ],

  typescript: [
    {
      regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/m,
      type: "function",
      nameGroup: 1,
    },
    {
      regex: /^(?:export\s+)?class\s+(\w+)/m,
      type: "class",
      nameGroup: 1,
    },
    {
      regex: /^(?:export\s+)?interface\s+(\w+)/m,
      type: "interface",
      nameGroup: 1,
    },
    {
      regex: /^(?:export\s+)?type\s+(\w+)\s*=/m,
      type: "type",
      nameGroup: 1,
    },
    {
      regex: /^(?:export\s+)?enum\s+(\w+)/m,
      type: "enum",
      nameGroup: 1,
    },
    {
      regex: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*[=:]/m,
      type: "constant",
      nameGroup: 1,
    },
  ],

  tsx: [
    {
      regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/m,
      type: "function",
      nameGroup: 1,
    },
    {
      regex: /^(?:export\s+)?class\s+(\w+)/m,
      type: "class",
      nameGroup: 1,
    },
    {
      regex: /^(?:export\s+)?interface\s+(\w+)/m,
      type: "interface",
      nameGroup: 1,
    },
    {
      regex: /^(?:export\s+)?type\s+(\w+)\s*=/m,
      type: "type",
      nameGroup: 1,
    },
    {
      regex: /^(?:export\s+)?(?:const|let)\s+(\w+)\s*[=:]/m,
      type: "constant",
      nameGroup: 1,
    },
  ],

  jsx: [
    {
      regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/m,
      type: "function",
      nameGroup: 1,
    },
    {
      regex: /^(?:export\s+)?class\s+(\w+)/m,
      type: "class",
      nameGroup: 1,
    },
    {
      regex: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=/m,
      type: "constant",
      nameGroup: 1,
    },
  ],

  go: [
    { regex: /^func\s+(?:\([^)]+\)\s+)?(\w+)/m, type: "function", nameGroup: 1 },
    { regex: /^type\s+(\w+)\s+struct/m, type: "class", nameGroup: 1 },
    { regex: /^type\s+(\w+)\s+interface/m, type: "interface", nameGroup: 1 },
  ],

  rust: [
    {
      regex: /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/m,
      type: "function",
      nameGroup: 1,
    },
    { regex: /^(?:pub\s+)?struct\s+(\w+)/m, type: "class", nameGroup: 1 },
    { regex: /^(?:pub\s+)?enum\s+(\w+)/m, type: "enum", nameGroup: 1 },
    { regex: /^(?:pub\s+)?trait\s+(\w+)/m, type: "interface", nameGroup: 1 },
    { regex: /^impl(?:<[^>]+>)?\s+(\w+)/m, type: "class", nameGroup: 1 },
    { regex: /^(?:pub\s+)?mod\s+(\w+)/m, type: "module", nameGroup: 1 },
  ],

  ruby: [
    { regex: /^def\s+(\w+)/m, type: "function", nameGroup: 1 },
    { regex: /^class\s+(\w+)/m, type: "class", nameGroup: 1 },
    { regex: /^module\s+(\w+)/m, type: "module", nameGroup: 1 },
  ],

  php: [
    {
      regex: /^(?:public|private|protected)?\s*function\s+(\w+)/m,
      type: "function",
      nameGroup: 1,
    },
    { regex: /^class\s+(\w+)/m, type: "class", nameGroup: 1 },
    { regex: /^interface\s+(\w+)/m, type: "interface", nameGroup: 1 },
    { regex: /^trait\s+(\w+)/m, type: "class", nameGroup: 1 },
  ],

  java: [
    {
      regex:
        /^(?:public|private|protected)?\s*(?:static\s+)?(?:\w+\s+)+(\w+)\s*\(/m,
      type: "function",
      nameGroup: 1,
    },
    {
      regex: /^(?:public|private|protected)?\s*class\s+(\w+)/m,
      type: "class",
      nameGroup: 1,
    },
    {
      regex: /^(?:public|private|protected)?\s*interface\s+(\w+)/m,
      type: "interface",
      nameGroup: 1,
    },
    {
      regex: /^(?:public|private|protected)?\s*enum\s+(\w+)/m,
      type: "enum",
      nameGroup: 1,
    },
  ],

  kotlin: [
    { regex: /^(?:suspend\s+)?fun\s+(\w+)/m, type: "function", nameGroup: 1 },
    {
      regex: /^(?:data\s+)?class\s+(\w+)/m,
      type: "class",
      nameGroup: 1,
    },
    { regex: /^interface\s+(\w+)/m, type: "interface", nameGroup: 1 },
    { regex: /^object\s+(\w+)/m, type: "class", nameGroup: 1 },
    { regex: /^enum\s+class\s+(\w+)/m, type: "enum", nameGroup: 1 },
  ],

  scala: [
    { regex: /^def\s+(\w+)/m, type: "function", nameGroup: 1 },
    { regex: /^class\s+(\w+)/m, type: "class", nameGroup: 1 },
    { regex: /^trait\s+(\w+)/m, type: "interface", nameGroup: 1 },
    { regex: /^object\s+(\w+)/m, type: "class", nameGroup: 1 },
    { regex: /^case\s+class\s+(\w+)/m, type: "class", nameGroup: 1 },
  ],

  swift: [
    { regex: /^func\s+(\w+)/m, type: "function", nameGroup: 1 },
    { regex: /^class\s+(\w+)/m, type: "class", nameGroup: 1 },
    { regex: /^struct\s+(\w+)/m, type: "class", nameGroup: 1 },
    { regex: /^protocol\s+(\w+)/m, type: "interface", nameGroup: 1 },
    { regex: /^enum\s+(\w+)/m, type: "enum", nameGroup: 1 },
    { regex: /^extension\s+(\w+)/m, type: "class", nameGroup: 1 },
  ],

  csharp: [
    {
      regex:
        /^(?:public|private|protected|internal)?\s*(?:static\s+)?(?:async\s+)?(?:\w+\s+)+(\w+)\s*\(/m,
      type: "function",
      nameGroup: 1,
    },
    {
      regex: /^(?:public|private|protected|internal)?\s*class\s+(\w+)/m,
      type: "class",
      nameGroup: 1,
    },
    {
      regex: /^(?:public|private|protected|internal)?\s*interface\s+(\w+)/m,
      type: "interface",
      nameGroup: 1,
    },
    {
      regex: /^(?:public|private|protected|internal)?\s*struct\s+(\w+)/m,
      type: "class",
      nameGroup: 1,
    },
    {
      regex: /^(?:public|private|protected|internal)?\s*enum\s+(\w+)/m,
      type: "enum",
      nameGroup: 1,
    },
  ],

  c: [
    {
      regex: /^(?:static\s+)?(?:\w+\s+)+(\w+)\s*\([^)]*\)\s*\{/m,
      type: "function",
      nameGroup: 1,
    },
    { regex: /^struct\s+(\w+)/m, type: "class", nameGroup: 1 },
    { regex: /^typedef\s+struct\s+(\w+)/m, type: "class", nameGroup: 1 },
    { regex: /^enum\s+(\w+)/m, type: "enum", nameGroup: 1 },
  ],

  cpp: [
    {
      regex: /^(?:virtual\s+)?(?:\w+\s+)+(\w+)\s*\([^)]*\)\s*(?:const\s*)?\{/m,
      type: "function",
      nameGroup: 1,
    },
    { regex: /^class\s+(\w+)/m, type: "class", nameGroup: 1 },
    { regex: /^struct\s+(\w+)/m, type: "class", nameGroup: 1 },
    { regex: /^namespace\s+(\w+)/m, type: "module", nameGroup: 1 },
    { regex: /^enum\s+(?:class\s+)?(\w+)/m, type: "enum", nameGroup: 1 },
  ],
};

// Alias similar languages
PATTERNS.mjs = PATTERNS.javascript;
PATTERNS.cjs = PATTERNS.javascript;
PATTERNS.objc = PATTERNS.c;

interface Boundary {
  line: number;
  type: ChunkType;
  name?: string;
}

export class CodeChunker implements Chunker {
  private maxLines = MAX_CHUNK_LINES;
  private minLines = MIN_CHUNK_LINES;

  /**
   * Find all definition boundaries in the code
   */
  private findBoundaries(lines: string[], patterns: Pattern[]): Boundary[] {
    const boundaries: Boundary[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      for (const pattern of patterns) {
        const match = line.match(pattern.regex);
        if (match) {
          boundaries.push({
            line: i,
            type: pattern.type,
            name: match[pattern.nameGroup],
          });
          break;
        }
      }
    }

    return boundaries;
  }

  /**
   * Split content into chunks based on boundaries
   */
  chunk(
    content: string,
    filePath: string,
    relativePath: string,
    language: string
  ): Chunk[] {
    const lines = content.split("\n");
    const patterns = PATTERNS[language] || [];
    const chunks: Chunk[] = [];

    // If no patterns for this language, treat whole file as one chunk
    if (patterns.length === 0) {
      return this.chunkBySize(content, filePath, relativePath, language);
    }

    // Find all definition boundaries
    const boundaries = this.findBoundaries(lines, patterns);

    // If no boundaries found, chunk by size
    if (boundaries.length === 0) {
      return this.chunkBySize(content, filePath, relativePath, language);
    }

    // Create chunks from boundaries
    for (let i = 0; i < boundaries.length; i++) {
      const start = boundaries[i].line;
      const end =
        i < boundaries.length - 1 ? boundaries[i + 1].line - 1 : lines.length - 1;

      const chunkLines = lines.slice(start, end + 1);
      const chunkContent = chunkLines.join("\n");

      // Skip if chunk is too small
      if (chunkLines.length < this.minLines && boundaries.length > 1) {
        continue;
      }

      // If chunk is too large, split it
      if (chunkLines.length > this.maxLines) {
        const subChunks = this.splitLargeChunk(
          chunkLines,
          start,
          filePath,
          relativePath,
          language,
          boundaries[i].type,
          boundaries[i].name
        );
        chunks.push(...subChunks);
      } else {
        chunks.push({
          id: hashContent(`${filePath}:${start}`),
          filePath,
          relativePath,
          content: chunkContent,
          startLine: start + 1, // 1-indexed
          endLine: end + 1,
          type: boundaries[i].type,
          name: boundaries[i].name,
          language,
          tokens: countTokens(chunkContent),
        });
      }
    }

    // Handle content before first boundary
    if (boundaries.length > 0 && boundaries[0].line > 0) {
      const preambleLines = lines.slice(0, boundaries[0].line);
      if (preambleLines.length >= this.minLines) {
        const preambleContent = preambleLines.join("\n");
        chunks.unshift({
          id: hashContent(`${filePath}:0`),
          filePath,
          relativePath,
          content: preambleContent,
          startLine: 1,
          endLine: boundaries[0].line,
          type: "section",
          name: "imports/preamble",
          language,
          tokens: countTokens(preambleContent),
        });
      }
    }

    return chunks;
  }

  /**
   * Chunk file by size when no language patterns available
   */
  private chunkBySize(
    content: string,
    filePath: string,
    relativePath: string,
    language: string
  ): Chunk[] {
    const lines = content.split("\n");
    const chunks: Chunk[] = [];

    // If file is small enough, return as single chunk
    if (lines.length <= this.maxLines) {
      return [
        {
          id: hashContent(`${filePath}:0`),
          filePath,
          relativePath,
          content,
          startLine: 1,
          endLine: lines.length,
          type: "section",
          language,
          tokens: countTokens(content),
        },
      ];
    }

    // Split into chunks of maxLines
    for (let i = 0; i < lines.length; i += this.maxLines) {
      const end = Math.min(i + this.maxLines, lines.length);
      const chunkLines = lines.slice(i, end);
      const chunkContent = chunkLines.join("\n");

      chunks.push({
        id: hashContent(`${filePath}:${i}`),
        filePath,
        relativePath,
        content: chunkContent,
        startLine: i + 1,
        endLine: end,
        type: "section",
        language,
        tokens: countTokens(chunkContent),
      });
    }

    return chunks;
  }

  /**
   * Split a large chunk into smaller pieces
   */
  private splitLargeChunk(
    lines: string[],
    startOffset: number,
    filePath: string,
    relativePath: string,
    language: string,
    type: ChunkType,
    name?: string
  ): Chunk[] {
    const chunks: Chunk[] = [];

    for (let i = 0; i < lines.length; i += this.maxLines) {
      const end = Math.min(i + this.maxLines, lines.length);
      const chunkLines = lines.slice(i, end);
      const chunkContent = chunkLines.join("\n");

      chunks.push({
        id: hashContent(`${filePath}:${startOffset + i}`),
        filePath,
        relativePath,
        content: chunkContent,
        startLine: startOffset + i + 1,
        endLine: startOffset + end,
        type,
        name: i === 0 ? name : `${name} (continued)`,
        language,
        tokens: countTokens(chunkContent),
      });
    }

    return chunks;
  }
}
