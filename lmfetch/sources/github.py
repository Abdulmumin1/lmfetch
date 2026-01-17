"""GitHub repository source - clones repos temporarily."""

import asyncio
import os
import time
import re
import shutil
import tempfile
from pathlib import Path

from .base import Source, SourceItem
from .codebase import CodebaseSource


def parse_github_url(url: str) -> tuple[str, str, str | None] | None:
    """Parse GitHub URL into (owner, repo, subpath)."""
    url = url.rstrip("/")

    patterns = [
        r"(?:https?://)?github\.com/([^/]+)/([^/]+)(?:/tree/[^/]+/(.+))?",
        r"(?:https?://)?github\.com/([^/]+)/([^/]+)(?:/blob/[^/]+/(.+))?",
        r"(?:https?://)?github\.com/([^/]+)/([^/]+)",
    ]

    for pattern in patterns:
        match = re.match(pattern, url)
        if match:
            owner = match.group(1)
            repo = match.group(2).replace(".git", "")
            subpath = match.group(3) if match.lastindex >= 3 else None
            return owner, repo, subpath

    return None


class GitHubSource(Source):
    def __init__(
        self,
        url: str,
        include: list[str] | None = None,
        exclude: list[str] | None = None,
        depth: int = 1,
    ):
        parsed = parse_github_url(url)
        if not parsed:
            raise ValueError(f"Invalid GitHub URL: {url}")

        self.owner, self.repo, self.subpath = parsed
        self.include = include
        self.exclude = exclude
        self.depth = depth
        self._temp_dir: Path | None = None

    @property
    def clone_url(self) -> str:
        return f"https://github.com/{self.owner}/{self.repo}.git"

    async def scan(self) -> list[SourceItem]:
        # Cache structure: ~/.cache/lmfetch/repos/<owner>/<repo>
        cache_base = Path.home() / ".cache" / "lmfetch" / "repos"
        repo_path = cache_base / self.owner / self.repo
        self._temp_dir = None

        if repo_path.exists():
            # Check if we should update (TTL: 1 hour)
            last_update = 0
            git_head = repo_path / ".git" / "HEAD"
            if git_head.exists():
                last_update = git_head.stat().st_mtime
            
            # Default TTL: 3600 seconds (1 hour)
            if time.time() - last_update > 3600:
                # Update existing repo
                process = await asyncio.create_subprocess_exec(
                    "git", "pull",
                    cwd=str(repo_path),
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.PIPE,
                )
                _, stderr = await process.communicate()
                # Ignore pull errors (might be detached head, etc), just proceed
        else:
            # Clone new repo
            repo_path.parent.mkdir(parents=True, exist_ok=True)
            process = await asyncio.create_subprocess_exec(
                "git", "clone", "--depth", str(self.depth), "--single-branch",
                self.clone_url, str(repo_path),
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await process.communicate()

            if process.returncode != 0:
                raise RuntimeError(f"git clone failed: {stderr.decode()}")

        scan_path = repo_path
        if self.subpath:
            scan_path = scan_path / self.subpath

        source = CodebaseSource(scan_path, include=self.include, exclude=self.exclude)
        items = await source.scan()

        # Prefix paths with repo name for clarity
        for item in items:
            item.path = f"{self.owner}/{self.repo}/{item.path}"

        return items
