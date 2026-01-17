"""Token counting and budget management."""

import tiktoken

_encoding = None


def get_encoding():
    global _encoding
    if _encoding is None:
        _encoding = tiktoken.get_encoding("cl100k_base")
    return _encoding


def count_tokens(text: str) -> int:
    return len(get_encoding().encode(text, disallowed_special=()))


def parse_token_budget(budget: str) -> int:
    budget = budget.lower().strip()
    if budget.endswith("k"):
        return int(float(budget[:-1]) * 1000)
    elif budget.endswith("m"):
        return int(float(budget[:-1]) * 1000000)
    return int(budget)
