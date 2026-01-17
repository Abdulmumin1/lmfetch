"""File importance scoring - ranks files by structural importance."""

from pathlib import Path

# Files that are typically entry points or important
HIGH_IMPORTANCE_PATTERNS = [
    "main.py", "app.py", "index.py", "server.py", "cli.py",
    "main.ts", "app.ts", "index.ts", "server.ts",
    "main.js", "app.js", "index.js", "server.js",
    "main.go", "main.rs", "lib.rs",
    "README.md", "readme.md", "README.rst",
    "setup.py", "pyproject.toml", "package.json", "Cargo.toml", "go.mod",
]

# Directories that typically contain important code
IMPORTANT_DIRS = [
    "src", "lib", "core", "api", "app", "server",
]

# Directories that typically contain less important code
LOW_IMPORTANCE_DIRS = [
    "test", "tests", "spec", "specs", "__tests__",
    "examples", "example", "samples", "sample",
    "docs", "doc", "documentation",
    "scripts", "tools", "utils", "helpers",
    "vendor", "third_party",
    "migrations", "fixtures",
]


def compute_file_importance(path: str) -> float:
    """Compute importance score for a file (0.0 to 1.0)."""
    p = Path(path)
    name = p.name.lower()
    parts = [part.lower() for part in p.parts]

    score = 0.5  # Base score

    # High importance files
    if name in [pat.lower() for pat in HIGH_IMPORTANCE_PATTERNS]:
        score += 0.3

    # Entry point patterns
    if name.startswith("main") or name.startswith("index") or name.startswith("app"):
        score += 0.15

    # __init__.py files are often important for understanding structure
    if name == "__init__.py" and len(p.parts) <= 3:
        score += 0.1

    # Important directories
    for important_dir in IMPORTANT_DIRS:
        if important_dir in parts:
            score += 0.1
            break

    # Low importance directories
    for low_dir in LOW_IMPORTANCE_DIRS:
        if low_dir in parts:
            score -= 0.2
            break

    # Deeper files are often less important
    depth = len(p.parts)
    if depth > 5:
        score -= 0.1 * (depth - 5)

    # Config/meta files
    if name.endswith(".json") or name.endswith(".yaml") or name.endswith(".yml"):
        if name not in ("package.json", "tsconfig.json", "pyproject.toml"):
            score -= 0.1

    return max(0.0, min(1.0, score))


def compute_centrality(
    path: str,
    dependency_graph: dict[str, set[str]],
) -> float:
    """Compute how central a file is based on imports (PageRank-like)."""
    if path not in dependency_graph:
        return 0.0

    # Count incoming edges (files that import this)
    incoming = sum(1 for deps in dependency_graph.values() if path in deps)

    # Count outgoing edges (files this imports)
    outgoing = len(dependency_graph.get(path, set()))

    # Normalize - files that are imported a lot are more central
    total_files = len(dependency_graph)
    if total_files == 0:
        return 0.0

    # Weighted: incoming matters more than outgoing
    centrality = (incoming * 2 + outgoing) / (total_files * 3)

    return min(1.0, centrality)
