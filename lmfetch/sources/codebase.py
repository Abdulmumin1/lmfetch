"""Codebase source - scans local directories."""

import asyncio
from pathlib import Path

import aiofiles

from .base import Source, SourceItem

IGNORE_DIRS = {
    ".git", ".svn", ".hg", "node_modules", "__pycache__", ".venv", "venv",
    "env", ".env", "dist", "build", ".next", ".nuxt", "target", "out",
    ".idea", ".vscode", ".cache", "coverage", ".pytest_cache", ".mypy_cache",
}

IGNORE_FILES = {
    ".DS_Store", "Thumbs.db", ".gitignore", ".gitattributes",
    "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "Cargo.lock",
    "poetry.lock", "uv.lock",
    "CHANGELOG.md", "CHANGELOG", "HISTORY.md", "CONTRIBUTING.md",
    "LICENSE", "LICENSE.md", "NOTICE",
}

BINARY_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp", ".svg", ".bmp",
    ".pdf", ".zip", ".tar", ".gz", ".rar", ".7z",
    ".exe", ".dll", ".so", ".dylib", ".bin",
    ".mp3", ".mp4", ".wav", ".avi", ".mov",
    ".woff", ".woff2", ".ttf", ".eot",
    ".pyc", ".pyo", ".class", ".o",
}

LANGUAGE_MAP = {
    ".py": "python", ".js": "javascript", ".ts": "typescript",
    ".jsx": "jsx", ".tsx": "tsx", ".vue": "vue", ".svelte": "svelte",
    ".go": "go", ".rs": "rust", ".rb": "ruby", ".php": "php",
    ".java": "java", ".kt": "kotlin", ".scala": "scala",
    ".c": "c", ".cpp": "cpp", ".h": "c", ".hpp": "cpp",
    ".cs": "csharp", ".fs": "fsharp",
    ".swift": "swift", ".m": "objc",
    ".sh": "bash", ".bash": "bash", ".zsh": "zsh",
    ".sql": "sql", ".graphql": "graphql",
    ".html": "html", ".css": "css", ".scss": "scss", ".less": "less",
    ".json": "json", ".yaml": "yaml", ".yml": "yaml", ".toml": "toml",
    ".md": "markdown", ".mdx": "mdx", ".rst": "rst",
    ".dockerfile": "dockerfile", ".tf": "terraform",
}


class CodebaseSource(Source):
    def __init__(
        self,
        path: str | Path,
        include: list[str] | None = None,
        exclude: list[str] | None = None,
        force_large: bool = False,
    ):
        self.path = Path(path).resolve()
        self.include = include or []
        self.exclude = exclude or []
        self.force_large = force_large

    async def scan(self) -> list[SourceItem]:
        items = []
        files = self._find_files()

        semaphore = asyncio.Semaphore(100)

        async def read_file(file_path: Path) -> SourceItem | None:
            async with semaphore:
                try:
                    # Check file size (1MB)
                    size = file_path.stat().st_size
                    if size > 1024 * 1024 and not self.force_large:
                        return None

                    async with aiofiles.open(file_path, "r", encoding="utf-8", errors="replace") as f:
                        content = await f.read()
                    
                    # Check line count (20k)
                    if len(content.splitlines()) > 20000 and not self.force_large:
                        return None

                    rel_path = str(file_path.relative_to(self.path))
                    lang = LANGUAGE_MAP.get(file_path.suffix.lower())
                    return SourceItem(path=rel_path, content=content, language=lang)
                except Exception:
                    return None

        results = await asyncio.gather(*[read_file(f) for f in files])
        return [r for r in results if r is not None]

    def _find_files(self) -> list[Path]:
        files = []
        for item in self.path.rglob("*"):
            if not item.is_file():
                continue
            if self._should_ignore(item):
                continue
            if self.include and not self._matches_patterns(item, self.include):
                continue
            if self.exclude and self._matches_patterns(item, self.exclude):
                continue
            files.append(item)
        return files

    def _should_ignore(self, path: Path) -> bool:
        try:
            rel_path = path.relative_to(self.path)
            for part in rel_path.parts:
                if part in IGNORE_DIRS:
                    return True
        except ValueError:
            # Should not happen if path is inside self.path
            pass
        if path.name in IGNORE_FILES:
            return True
        if path.suffix.lower() in BINARY_EXTENSIONS:
            return True
        return False

    def _matches_patterns(self, path: Path, patterns: list[str]) -> bool:
        from fnmatch import fnmatch
        rel_path = str(path.relative_to(self.path))
        return any(fnmatch(rel_path, p) or fnmatch(path.name, p) for p in patterns)
