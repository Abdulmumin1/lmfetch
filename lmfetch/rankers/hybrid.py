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
        use_hyde: bool | None = None,
        dependency_graph: dict[str, set[str]] | None = None,
    ):
        self.keyword_weight = keyword_weight
        self.embedding_weight = embedding_weight
        self.importance_weight = importance_weight
        self.dependency_graph = dependency_graph or {}
        self.use_hyde = use_hyde if use_hyde is not None else True

        # Auto-detect if embeddings should be used
        if use_embeddings is None:
            use_embeddings = bool(os.environ.get("OPENAI_API_KEY")) or bool(os.environ.get("GOOGLE_API_KEY"))
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

    async def rank(self, query: str, chunks: list[Chunk]) -> list[ScoredChunk]:
        if not chunks:
            return []

        # Keyword scores
        keyword_scored = await self.keyword_ranker.rank(query, chunks)
        keyword_scores = {s.chunk.path + str(s.chunk.start_line): s.score for s in keyword_scored}

        # Embedding scores (if available)
        embedding_scores: dict[str, float] = {}
        if self.use_embeddings:
            embedding_ranker = self._get_embedding_ranker()
            if embedding_ranker:
                try:
                    # HyDE Generation
                    if self.use_hyde:
                        try:
                            # Use OpenAI fallback or similar, but we need a generative model here.
                            # Since we don't have a reliable "generate_text" client linked here easily 
                            # (except loading ai_query), we'll try to use it.
                            from ai_query import generate_text, openai, google, anthropic
                            
                            # Simple heuristics for model selection
                            model_name = os.environ.get("LMFETCH_MODEL", "gemini-3-flash-preview")
                            if "gpt" in model_name:
                                model = openai(model_name)
                            elif "claude" in model_name:
                                model = anthropic(model_name)
                            else:
                                # Default to google or what's available
                                model = google(model_name)

                            hyde_prompt = (
                                f"Write a hypothetical code snippet or documentation that answers the question: '{query}'. "
                                "Do not explain, just provide the code/doc."
                            )
                            # Short timeout for speed
                            from ..utils import retry
                            
                            @retry(retries=2, delay=0.5)
                            async def _gen_hyde():
                                return await generate_text(model=model, prompt=hyde_prompt)
                                
                            hypothetical_doc = (await _gen_hyde()).text
                            
                            # Combine query + hypothetical doc
                            query_elements = [query, hypothetical_doc[:1000]] # Limit size
                            
                            # We need EmbeddingRanker to support list of queries? 
                            # Currently rank() takes str. 
                            # We can just concatenate or average?
                            # Concatenation is simplest for now: "Query\n---\nHypothetical Doc"
                            enhanced_query = f"{query}\n---\n{hypothetical_doc[:1000]}"
                            embedding_scored = await embedding_ranker.rank(enhanced_query, chunks)
                        except Exception:
                            # Fallback to normal query if HyDE fails (e.g. no gen model)
                            embedding_scored = await embedding_ranker.rank(query, chunks)
                    else:
                        embedding_scored = await embedding_ranker.rank(query, chunks)

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

            # Penalize markdown/text files if query looks like code search
            # Heuristic: if extension is .md, .txt, .rst reduce score
            if chunk.path.endswith((".md", ".mdx", ".txt", ".rst")):
                 final_score *= 0.6  # 40% penalty for docs

            scored.append(ScoredChunk(chunk=chunk, score=final_score))

        scored.sort(key=lambda x: x.score, reverse=True)

        # Normalize
        if scored and scored[0].score > 0:
            max_score = scored[0].score
            for s in scored:
                s.score = s.score / max_score

        return scored
