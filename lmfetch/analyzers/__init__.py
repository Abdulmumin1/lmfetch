"""Import/dependency analyzer - follows imports to find related files."""

import re
from dataclasses import dataclass
from pathlib import Path


@dataclass
class ImportInfo:
    module: str
    is_relative: bool
    alias: str | None = None


IMPORT_PATTERNS = {
    "python": [
        (r"^from\s+(\.+)?(\S+)\s+import", True),  # from x import y
        (r"^import\s+(\S+)", False),  # import x
    ],
    "javascript": [
        (r"^import\s+.*?\s+from\s+['\"](.+?)['\"]", False),
        (r"^import\s+['\"](.+?)['\"]", False),
        (r"require\(['\"](.+?)['\"]\)", False),
    ],
    "typescript": [
        (r"^import\s+.*?\s+from\s+['\"](.+?)['\"]", False),
        (r"^import\s+['\"](.+?)['\"]", False),
        (r"require\(['\"](.+?)['\"]\)", False),
    ],
    "go": [
        (r"^\s*\"(.+?)\"", False),  # inside import block
        (r"^import\s+\"(.+?)\"", False),
    ],
    "rust": [
        (r"^use\s+(\S+)", False),
        (r"^mod\s+(\w+)", False),
    ],
}


def extract_imports(content: str, language: str | None) -> list[ImportInfo]:
    if not language or language not in IMPORT_PATTERNS:
        return []

    imports = []
    patterns = IMPORT_PATTERNS[language]

    for line in content.split("\n"):
        line = line.strip()
        for pattern, is_from_import in patterns:
            match = re.match(pattern, line)
            if match:
                if is_from_import and language == "python":
                    dots = match.group(1) or ""
                    module = match.group(2)
                    imports.append(ImportInfo(
                        module=module,
                        is_relative=bool(dots),
                    ))
                else:
                    imports.append(ImportInfo(
                        module=match.group(1),
                        is_relative=match.group(1).startswith(".") if language in ("javascript", "typescript") else False,
                    ))
                break

    return imports


def resolve_import_to_path(
    import_info: ImportInfo,
    source_path: str,
    all_paths: set[str],
    language: str | None,
) -> str | None:
    """Try to resolve an import to an actual file path."""
    if not language:
        return None

    source = Path(source_path)
    module = import_info.module

    if language == "python":
        # Convert module.path to module/path
        module_path = module.replace(".", "/")
        candidates = [
            f"{module_path}.py",
            f"{module_path}/__init__.py",
        ]
        if import_info.is_relative:
            base = source.parent
            candidates = [str(base / c) for c in candidates]
    elif language in ("javascript", "typescript"):
        if module.startswith("."):
            base = source.parent
            candidates = [
                str(base / f"{module}.ts"),
                str(base / f"{module}.tsx"),
                str(base / f"{module}.js"),
                str(base / f"{module}.jsx"),
                str(base / f"{module}/index.ts"),
                str(base / f"{module}/index.js"),
            ]
        else:
            return None  # node_modules, skip
    else:
        return None

    for candidate in candidates:
        # Normalize path
        candidate = candidate.replace("\\", "/")
        if candidate.startswith("./"):
            candidate = candidate[2:]
        if candidate in all_paths:
            return candidate

    return None


def build_dependency_graph(
    files: dict[str, tuple[str, str | None]],  # path -> (content, language)
) -> dict[str, set[str]]:
    """Build a graph of file dependencies.

    Returns dict mapping file path to set of paths it imports.
    """
    all_paths = set(files.keys())
    graph: dict[str, set[str]] = {path: set() for path in files}

    for path, (content, language) in files.items():
        imports = extract_imports(content, language)
        for imp in imports:
            resolved = resolve_import_to_path(imp, path, all_paths, language)
            if resolved:
                graph[path].add(resolved)

    return graph


def get_related_files(
    target_files: set[str],
    graph: dict[str, set[str]],
    depth: int = 2,
) -> set[str]:
    """Get files related to target files (imports and importers)."""
    related = set(target_files)

    # Build reverse graph (what imports what)
    reverse_graph: dict[str, set[str]] = {path: set() for path in graph}
    for path, imports in graph.items():
        for imp in imports:
            if imp in reverse_graph:
                reverse_graph[imp].add(path)

    # BFS to find related files
    frontier = set(target_files)
    for _ in range(depth):
        next_frontier = set()
        for path in frontier:
            # Files this imports
            next_frontier.update(graph.get(path, set()))
            # Files that import this
            next_frontier.update(reverse_graph.get(path, set()))
        next_frontier -= related
        related.update(next_frontier)
        frontier = next_frontier
        if not frontier:
            break

    return related
