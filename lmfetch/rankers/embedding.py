"""Embedding-based semantic ranker using ai-query."""

import asyncio
import hashlib
import json
import os
from pathlib import Path

from ..chunkers.base import Chunk
from .base import Ranker, ScoredChunk
from ai_query import embed_many, google, openai


def cosine_similarity(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(x * x for x in b) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


class EmbeddingCache:
    def __init__(self, cache_dir: Path | None = None):
        self.cache_dir = cache_dir or Path.home() / ".cache" / "lmfetch" / "embeddings"
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self._memory_cache: dict[str, list[float]] = {}

    def _hash_text(self, text: str) -> str:
        return hashlib.sha256(text.encode()).hexdigest()[:16]

    def get(self, text: str) -> list[float] | None:
        key = self._hash_text(text)
        if key in self._memory_cache:
            return self._memory_cache[key]

        cache_file = self.cache_dir / f"{key}.json"
        if cache_file.exists():
            try:
                embedding = json.loads(cache_file.read_text())
                self._memory_cache[key] = embedding
                return embedding
            except Exception:
                pass
        return None

    def set(self, text: str, embedding: list[float]):
        key = self._hash_text(text)
        self._memory_cache[key] = embedding
        cache_file = self.cache_dir / f"{key}.json"
        try:
            cache_file.write_text(json.dumps(embedding))
        except Exception:
            pass


class EmbeddingRanker(Ranker):
    def __init__(
        self,
        model: str = "text-embedding-005",
        batch_size: int = 20,
        provider_options: dict | None = None,
    ):
        self.model = model
        self.batch_size = batch_size
        self.provider_options = provider_options or {}
        self.cache = EmbeddingCache()

    async def _embed_texts(self, texts: list[str]) -> list[list[float]]:
        # Check cache first
        results: list[list[float] | None] = []
        uncached_indices: list[int] = []
        uncached_texts: list[str] = []

        for i, text in enumerate(texts):
            cached = self.cache.get(text)
            if cached:
                results.append(cached)
            else:
                results.append(None)
                uncached_indices.append(i)
                uncached_texts.append(text[:8000])  # Truncate for embedding

        # Embed uncached texts in batches
        if uncached_texts:
            for batch_start in range(0, len(uncached_texts), self.batch_size):
                batch = uncached_texts[batch_start : batch_start + self.batch_size]
                try:
                    # Determine provider and model object
                    model_obj = google.embedding(self.model)

                    response = await embed_many(
                        model=model_obj,
                        values=batch,
                        provider_options=self.provider_options,
                    )
                    print(response.embeddings)
                    for j, embedding in enumerate(response.embeddings):
                        idx = uncached_indices[batch_start + j]
                        results[idx] = embedding
                        self.cache.set(texts[idx], embedding)
                except Exception:
                    # If embedding fails, leave as None (will be filtered out)
                    pass

        return [r if r else [] for r in results]

    async def rank(self, query: str, chunks: list[Chunk]) -> list[ScoredChunk]:
        if not chunks:
            return []

        # Get embeddings
        texts = [query] + [c.content[:2000] for c in chunks]
        embeddings = await self._embed_texts(texts)

        if not embeddings or not embeddings[0]:
            # Fallback to keyword ranking
            from .keyword import KeywordRanker
            return await KeywordRanker().rank(query, chunks)

        query_embedding = embeddings[0]
        chunk_embeddings = embeddings[1:]

        # Score by cosine similarity
        scored = []
        for chunk, embedding in zip(chunks, chunk_embeddings):
            if embedding:
                score = cosine_similarity(query_embedding, embedding)
            else:
                score = 0.0
            scored.append(ScoredChunk(chunk=chunk, score=score))

        scored.sort(key=lambda x: x.score, reverse=True)
        return scored
