"""Base ranker interface."""

from dataclasses import dataclass
from ..chunkers.base import Chunk


@dataclass
class ScoredChunk:
    chunk: Chunk
    score: float

    @property
    def path(self) -> str:
        return self.chunk.path

    @property
    def content(self) -> str:
        return self.chunk.content


class Ranker:
    def rank(self, query: str, chunks: list[Chunk]) -> list[ScoredChunk]:
        raise NotImplementedError
