"""LLM-powered smart analysis using fast/cheap models."""

import asyncio


async def summarize_chunk(content: str, max_length: int = 200) -> str:
    """Summarize a code chunk using a fast model."""
    try:
        from ai_query import generate_text, google

        result = await generate_text(
            model=google("gemini-2.0-flash-lite"),
            system="You are a code summarizer. Output ONLY a brief 1-2 sentence summary of what this code does. No markdown, no preamble.",
            prompt=f"Summarize this code:\n\n{content[:3000]}",
        )
        return result.text.strip()[:max_length]
    except Exception:
        # Fallback: first line or docstring
        lines = content.strip().split("\n")
        for line in lines[:5]:
            line = line.strip()
            if line.startswith('"""') or line.startswith("'''"):
                return line.strip("\"'")[:max_length]
            if line.startswith("#") or line.startswith("//"):
                return line.lstrip("#/ ")[:max_length]
        return lines[0][:max_length] if lines else ""


async def compute_relevance_score(query: str, content: str) -> float:
    """Use fast model to score relevance of content to query."""
    try:
        from ai_query import generate_text, google

        result = await generate_text(
            model=google("gemini-2.0-flash-lite"),
            system="You are a relevance scorer. Output ONLY a number from 0.0 to 1.0 indicating how relevant the code is to the query. Just the number, nothing else.",
            prompt=f"Query: {query}\n\nCode:\n{content[:2000]}",
        )
        score = float(result.text.strip())
        return max(0.0, min(1.0, score))
    except Exception:
        return 0.5


async def expand_query(query: str) -> list[str]:
    """Expand a query into related search terms."""
    try:
        from ai_query import generate_text, google

        result = await generate_text(
            model=google("gemini-2.0-flash-lite"),
            system="You expand search queries for code search. Given a query, output 3-5 related terms/phrases that would help find relevant code. Output one per line, no numbers or bullets.",
            prompt=f"Expand this code search query: {query}",
        )
        terms = [t.strip() for t in result.text.strip().split("\n") if t.strip()]
        return [query] + terms[:4]
    except Exception:
        return [query]


async def batch_summarize(chunks: list[tuple[str, str]], concurrency: int = 5) -> dict[str, str]:
    """Summarize multiple chunks concurrently."""
    semaphore = asyncio.Semaphore(concurrency)

    async def summarize_with_limit(path: str, content: str) -> tuple[str, str]:
        async with semaphore:
            summary = await summarize_chunk(content)
            return path, summary

    results = await asyncio.gather(*[
        summarize_with_limit(path, content)
        for path, content in chunks
    ])

    return dict(results)


async def rerank_with_llm(
    query: str,
    chunks: list[tuple[str, str, float]],  # (path, content, initial_score)
    top_k: int = 20,
) -> list[tuple[str, str, float]]:
    """Rerank top chunks using LLM for better relevance."""
    # Only rerank top candidates
    candidates = sorted(chunks, key=lambda x: x[2], reverse=True)[:top_k * 2]

    async def score_chunk(path: str, content: str, initial: float) -> tuple[str, str, float]:
        llm_score = await compute_relevance_score(query, content)
        # Blend initial score with LLM score
        final = initial * 0.4 + llm_score * 0.6
        return path, content, final

    reranked = await asyncio.gather(*[
        score_chunk(path, content, score)
        for path, content, score in candidates
    ])

    return sorted(reranked, key=lambda x: x[2], reverse=True)
