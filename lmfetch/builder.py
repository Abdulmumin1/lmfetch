"""Smart context builder - orchestrates sources, analyzers, chunkers, rankers."""

from dataclasses import dataclass, field
from pathlib import Path

from .sources import CodebaseSource, GitHubSource, parse_github_url, SourceItem
from .chunkers import CodeChunker
from .rankers import KeywordRanker, ScoredChunk
from .rankers.hybrid import HybridRanker
from .analyzers import build_dependency_graph, get_related_files
from .tokens import count_tokens


@dataclass
class ContextResult:
    query: str
    chunks: list[ScoredChunk]
    total_tokens: int
    budget: int
    files_scanned: int
    files_included: int
    source_type: str = "codebase"
    related_files_added: int = 0

    def to_text(self, format: str = "markdown") -> str:
        if format == "xml":
            return self._to_xml()
        return self._to_markdown()

    def _to_markdown(self) -> str:
        parts = []
        for scored in self.chunks:
            chunk = scored.chunk
            # Format: ## file.py:L10-50 (function: name)
            header = f"## {chunk.path}:L{chunk.start_line}-{chunk.end_line}"
            if chunk.name:
                header += f" ({chunk.chunk_type}: {chunk.name})"

            lang = chunk.language or ""
            code_block = f"```{lang}\n{chunk.content}\n```"
            parts.append(f"{header}\n\n{code_block}")

        return "\n\n---\n\n".join(parts)

    def _to_xml(self) -> str:
        parts = []
        for scored in self.chunks:
            chunk = scored.chunk
            attrs = f'path="{chunk.path}"'
            if chunk.name:
                attrs += f' name="{chunk.name}" type="{chunk.chunk_type}"'
            attrs += f' lines="{chunk.start_line}-{chunk.end_line}"'
            if chunk.language:
                attrs += f' language="{chunk.language}"'
            parts.append(f"<file {attrs}>\n{chunk.content}\n</file>")

        return "\n\n".join(parts)


@dataclass
class ContextBuilder:
    budget: int = 50000
    chunker: CodeChunker = field(default_factory=CodeChunker)
    follow_imports: bool = True
    import_depth: int = 1
    use_hybrid_ranking: bool = True
    use_smart_rerank: bool = False

    async def build(
        self,
        path: str | Path,
        query: str,
        include: list[str] | None = None,
        exclude: list[str] | None = None,
    ) -> ContextResult:
        path_str = str(path)

        # Detect source type
        if parse_github_url(path_str):
            source = GitHubSource(path_str, include=include, exclude=exclude)
            source_type = "github"
        else:
            source = CodebaseSource(path_str, include=include, exclude=exclude)
            source_type = "codebase"

        items = await source.scan()

        # Build dependency graph
        files_dict = {item.path: (item.content, item.language) for item in items}
        dep_graph = build_dependency_graph(files_dict) if self.follow_imports else {}

        # Chunk all files
        all_chunks = []
        for item in items:
            chunks = self.chunker.chunk(item.path, item.content, item.language)
            all_chunks.extend(chunks)

        # Initial ranking
        if self.use_hybrid_ranking:
            ranker = HybridRanker(dependency_graph=dep_graph)
        else:
            ranker = KeywordRanker()

        scored = await ranker.rank(query, all_chunks)

        # LLM-powered reranking if enabled
        if self.use_smart_rerank:
            from .analyzers.llm import rerank_with_llm

            chunks_for_rerank = [
                (s.chunk.path, s.chunk.content, s.score)
                for s in scored[:50]  # Top 50 candidates
            ]
            reranked = await rerank_with_llm(query, chunks_for_rerank, top_k=30)
            # Rebuild scored list with new scores
            path_content_to_chunk = {(s.chunk.path, s.chunk.content): s.chunk for s in scored}
            new_scored = []
            for path, content, new_score in reranked:
                chunk = path_content_to_chunk.get((path, content))
                if chunk:
                    new_scored.append(ScoredChunk(chunk=chunk, score=new_score))
            # Add remaining chunks that weren't reranked
            reranked_keys = {(path, content) for path, content, _ in reranked}
            for s in scored:
                if (s.chunk.path, s.chunk.content) not in reranked_keys:
                    new_scored.append(s)
            scored = new_scored

        # First pass: select top chunks within budget
        selected = []
        total_tokens = 0
        included_files = set()
        selected_paths = set()

        for s in scored:
            chunk_tokens = count_tokens(s.content)
            if total_tokens + chunk_tokens > self.budget * 0.7:  # Reserve 30% for related files
                continue
            selected.append(s)
            total_tokens += chunk_tokens
            included_files.add(s.path)
            selected_paths.add(s.path)

        # Second pass: add related files via imports
        related_files_added = 0
        if self.follow_imports and dep_graph:
            related = get_related_files(selected_paths, dep_graph, depth=self.import_depth)
            related -= selected_paths  # Don't re-add already selected

            # Find chunks from related files
            related_chunks = [s for s in scored if s.path in related and s.path not in selected_paths]

            for s in related_chunks:
                chunk_tokens = count_tokens(s.content)
                if total_tokens + chunk_tokens > self.budget:
                    continue
                selected.append(s)
                total_tokens += chunk_tokens
                if s.path not in included_files:
                    included_files.add(s.path)
                    related_files_added += 1

        # Re-sort by score
        selected.sort(key=lambda x: x.score, reverse=True)

        return ContextResult(
            query=query,
            chunks=selected,
            total_tokens=total_tokens,
            budget=self.budget,
            files_scanned=len(items),
            files_included=len(included_files),
            source_type=source_type,
            related_files_added=related_files_added,
        )
