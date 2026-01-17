"""Hybrid ranker - combines keyword, embedding, and importance signals."""

import asyncio
import os

from ..chunkers.base import Chunk
from ..analyzers.importance import compute_file_importance, compute_centrality
from .base import Ranker, ScoredChunk
from .keyword import KeywordRanker


class HybridRanker(Ranker):
    def __init__(
        self,
        keyword_weight: float = 0.4,
        embedding_weight: float = 0.4,
        importance_weight: float = 0.2,
        use_embeddings: bool | None = None,
        dependency_graph: dict[str, set[str]] | None = None,
    ):
        self.keyword_weight = keyword_weight
        self.embedding_weight = embedding_weight
        self.importance_weight = importance_weight
        self.dependency_graph = dependency_graph or {}

        # Auto-detect if embeddings should be used
        if use_embeddings is None:
            use_embeddings = bool(os.environ.get("OPENAI_API_KEY"))
        self.use_embeddings = use_embeddings

        self.keyword_ranker = KeywordRanker()
        self._embedding_ranker = None

    def _get_embedding_ranker(self):
        if self._embedding_ranker is None and self.use_embeddings:
            try:
                from .embedding import EmbeddingRanker
                self._embedding_ranker = EmbeddingRanker()
            except Exception:
                self.use_embeddings = False
        return self._embedding_ranker

    def rank(self, query: str, chunks: list[Chunk]) -> list[ScoredChunk]:
        if not chunks:
            return []

        # Keyword scores
        keyword_scored = self.keyword_ranker.rank(query, chunks)
        keyword_scores = {s.chunk.path + str(s.chunk.start_line): s.score for s in keyword_scored}

        # Embedding scores (if available)
        embedding_scores: dict[str, float] = {}
        if self.use_embeddings:
            embedding_ranker = self._get_embedding_ranker()
            if embedding_ranker:
                try:
                    embedding_scored = asyncio.get_event_loop().run_until_complete(
                        embedding_ranker.rank_async(query, chunks)
                    )
                    embedding_scores = {s.chunk.path + str(s.chunk.start_line): s.score for s in embedding_scored}
                except Exception:
                    pass

        # Importance scores
        importance_scores: dict[str, float] = {}
        for chunk in chunks:
            key = chunk.path + str(chunk.start_line)
            base_importance = compute_file_importance(chunk.path)
            centrality = compute_centrality(chunk.path, self.dependency_graph)
            importance_scores[key] = base_importance * 0.7 + centrality * 0.3

        # Combine scores
        scored = []
        for chunk in chunks:
            key = chunk.path + str(chunk.start_line)

            kw_score = keyword_scores.get(key, 0.0)
            emb_score = embedding_scores.get(key, 0.0) if embedding_scores else kw_score
            imp_score = importance_scores.get(key, 0.5)

            if self.use_embeddings and embedding_scores:
                final_score = (
                    kw_score * self.keyword_weight +
                    emb_score * self.embedding_weight +
                    imp_score * self.importance_weight
                )
            else:
                # No embeddings - redistribute weight
                final_score = (
                    kw_score * (self.keyword_weight + self.embedding_weight) +
                    imp_score * self.importance_weight
                )

            scored.append(ScoredChunk(chunk=chunk, score=final_score))

        scored.sort(key=lambda x: x.score, reverse=True)

        # Normalize
        if scored and scored[0].score > 0:
            max_score = scored[0].score
            for s in scored:
                s.score = s.score / max_score

        return scored
