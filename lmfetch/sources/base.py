"""Base source interface."""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path


@dataclass
class SourceItem:
    path: str
    content: str
    language: str | None = None
    metadata: dict | None = None


class Source(ABC):
    @abstractmethod
    async def scan(self) -> list[SourceItem]:
        """Scan and return all items from this source."""
        ...
