"""Keyword-based ranker using BM25-like scoring."""

import re
import math
from collections import Counter
from ..chunkers.base import Chunk
from .base import Ranker, ScoredChunk


def tokenize(text: str) -> list[str]:
    text = text.lower()
    tokens = re.findall(r"[a-z][a-z0-9_]*", text)
    expanded = []
    for token in tokens:
        expanded.append(token)
        parts = re.findall(r"[a-z]+", re.sub(r"([a-z])([A-Z])", r"\1_\2", token).lower())
        if len(parts) > 1:
            expanded.extend(parts)
    return expanded


class KeywordRanker(Ranker):
    def __init__(self, k1: float = 1.5, b: float = 0.75):
        self.k1 = k1
        self.b = b

    def rank(self, query: str, chunks: list[Chunk]) -> list[ScoredChunk]:
        if not chunks:
            return []

        query_tokens = set(tokenize(query))
        if not query_tokens:
            return [ScoredChunk(chunk=c, score=0.0) for c in chunks]

        doc_tokens = [tokenize(c.content) for c in chunks]
        doc_freqs = self._compute_doc_freqs(doc_tokens)
        avg_dl = sum(len(d) for d in doc_tokens) / len(doc_tokens)
        n_docs = len(chunks)

        scored = []
        for chunk, tokens in zip(chunks, doc_tokens):
            score = self._bm25_score(query_tokens, tokens, doc_freqs, avg_dl, n_docs)
            path_bonus = self._path_bonus(query_tokens, chunk.path)
            name_bonus = self._name_bonus(query_tokens, chunk.name) if chunk.name else 0
            final_score = score + path_bonus + name_bonus
            scored.append(ScoredChunk(chunk=chunk, score=final_score))

        scored.sort(key=lambda x: x.score, reverse=True)

        if scored and scored[0].score > 0:
            max_score = scored[0].score
            for s in scored:
                s.score = s.score / max_score if max_score > 0 else 0

        return scored

    def _compute_doc_freqs(self, doc_tokens: list[list[str]]) -> dict[str, int]:
        doc_freqs = Counter()
        for tokens in doc_tokens:
            doc_freqs.update(set(tokens))
        return doc_freqs

    def _bm25_score(
        self,
        query_tokens: set[str],
        doc_tokens: list[str],
        doc_freqs: dict[str, int],
        avg_dl: float,
        n_docs: int,
    ) -> float:
        dl = len(doc_tokens)
        term_freqs = Counter(doc_tokens)
        score = 0.0

        for term in query_tokens:
            if term not in term_freqs:
                continue
            tf = term_freqs[term]
            df = doc_freqs.get(term, 0)
            idf = math.log((n_docs - df + 0.5) / (df + 0.5) + 1)
            tf_component = (tf * (self.k1 + 1)) / (tf + self.k1 * (1 - self.b + self.b * dl / avg_dl))
            score += idf * tf_component

        return score

    def _path_bonus(self, query_tokens: set[str], path: str) -> float:
        path_tokens = set(tokenize(path))
        overlap = len(query_tokens & path_tokens)
        return overlap * 2.0

    def _name_bonus(self, query_tokens: set[str], name: str) -> float:
        name_tokens = set(tokenize(name))
        overlap = len(query_tokens & name_tokens)
        return overlap * 3.0
