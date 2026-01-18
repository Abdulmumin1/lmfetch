"""lmfetch - Build intelligent context from codebases and URLs for LLMs."""

import typing

__version__ = "0.2.0"

def __getattr__(name: str) -> typing.Any:
    if name == "ContextBuilder":
        from .builder import ContextBuilder
        return ContextBuilder
    if name == "ContextResult":
        from .builder import ContextResult
        return ContextResult
    raise AttributeError(f"module 'lmfetch' has no attribute '{name}'")

__all__ = ["ContextBuilder", "ContextResult"]
