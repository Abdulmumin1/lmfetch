"""Code-aware chunker using regex patterns for common languages."""

import re
from .base import Chunk, Chunker

FUNCTION_PATTERNS = {
    "python": [
        (r"^(async\s+)?def\s+(\w+)", "function"),
        (r"^class\s+(\w+)", "class"),
    ],
    "javascript": [
        (r"^(?:export\s+)?(?:async\s+)?function\s+(\w+)", "function"),
        (r"^(?:export\s+)?class\s+(\w+)", "class"),
        (r"^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(", "function"),
    ],
    "typescript": [
        (r"^(?:export\s+)?(?:async\s+)?function\s+(\w+)", "function"),
        (r"^(?:export\s+)?class\s+(\w+)", "class"),
        (r"^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(", "function"),
        (r"^(?:export\s+)?interface\s+(\w+)", "interface"),
        (r"^(?:export\s+)?type\s+(\w+)", "type"),
    ],
    "go": [
        (r"^func\s+(?:\([^)]+\)\s+)?(\w+)", "function"),
        (r"^type\s+(\w+)\s+struct", "struct"),
        (r"^type\s+(\w+)\s+interface", "interface"),
    ],
    "rust": [
        (r"^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)", "function"),
        (r"^(?:pub\s+)?struct\s+(\w+)", "struct"),
        (r"^(?:pub\s+)?enum\s+(\w+)", "enum"),
        (r"^(?:pub\s+)?trait\s+(\w+)", "trait"),
        (r"^impl(?:<[^>]+>)?\s+(\w+)", "impl"),
    ],
}

MAX_CHUNK_LINES = 200
MIN_CHUNK_LINES = 10


class CodeChunker(Chunker):
    def chunk(self, path: str, content: str, language: str | None = None) -> list[Chunk]:
        lines = content.split("\n")

        if len(lines) <= MAX_CHUNK_LINES:
            return [Chunk(
                path=path,
                content=content,
                start_line=1,
                end_line=len(lines),
                chunk_type="file",
                language=language,
            )]

        if language and language in FUNCTION_PATTERNS:
            chunks = self._chunk_by_definitions(path, lines, language)
            if chunks:
                return chunks

        return self._chunk_by_size(path, lines, language)

    def _chunk_by_definitions(self, path: str, lines: list[str], language: str) -> list[Chunk]:
        patterns = FUNCTION_PATTERNS[language]
        definitions = []

        for i, line in enumerate(lines):
            for pattern, def_type in patterns:
                match = re.match(pattern, line.strip())
                if match:
                    name = match.group(1) if match.lastindex else None
                    if name and name in ("async", "export"):
                        name = match.group(2) if match.lastindex >= 2 else None
                    definitions.append((i, def_type, name))
                    break

        if not definitions:
            return []

        chunks = []
        for idx, (line_num, def_type, name) in enumerate(definitions):
            if idx + 1 < len(definitions):
                end_line = definitions[idx + 1][0]
            else:
                end_line = len(lines)

            chunk_content = "\n".join(lines[line_num:end_line])
            chunks.append(Chunk(
                path=path,
                content=chunk_content,
                start_line=line_num + 1,
                end_line=end_line,
                chunk_type=def_type,
                name=name,
                language=language,
            ))

        if definitions[0][0] > 0:
            header_content = "\n".join(lines[:definitions[0][0]])
            if header_content.strip():
                chunks.insert(0, Chunk(
                    path=path,
                    content=header_content,
                    start_line=1,
                    end_line=definitions[0][0],
                    chunk_type="header",
                    language=language,
                ))

        return chunks

    def _chunk_by_size(self, path: str, lines: list[str], language: str | None) -> list[Chunk]:
        chunks = []
        for i in range(0, len(lines), MAX_CHUNK_LINES):
            end = min(i + MAX_CHUNK_LINES, len(lines))
            chunk_content = "\n".join(lines[i:end])
            chunks.append(Chunk(
                path=path,
                content=chunk_content,
                start_line=i + 1,
                end_line=end,
                chunk_type="section",
                language=language,
            ))
        return chunks
