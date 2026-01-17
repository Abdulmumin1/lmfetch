"""Base chunker interface."""

from dataclasses import dataclass


@dataclass
class Chunk:
    path: str
    content: str
    start_line: int
    end_line: int
    chunk_type: str  # "file", "function", "class", "section"
    name: str | None = None
    language: str | None = None

    @property
    def header(self) -> str:
        if self.name:
            return f"{self.path}:{self.start_line} ({self.chunk_type}: {self.name})"
        return f"{self.path}:{self.start_line}-{self.end_line}"


class Chunker:
    def chunk(self, path: str, content: str, language: str | None = None) -> list[Chunk]:
        raise NotImplementedError
