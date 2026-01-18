import time
import sys
import os

# Ensure we can import lmfetch
sys.path.insert(0, os.getcwd())

from lmfetch.chunkers.code import CodeChunker

def benchmark_chunking():
    # Synthetic large file content (approx 1MB)
    py_content = "def foo():\n    pass\n\nclass Bar:\n    def baz(self):\n        return 1\n" * 10000
    js_content = "function foo() { return 1; }\nclass Bar { baz() { return 1; } }\n" * 10000

    chunker = CodeChunker()

    print(f"Benchmarking Python chunking ({len(py_content)/1024/1024:.2f} MB)...")
    start = time.perf_counter()
    for _ in range(5):
        chunker.chunk("test.py", py_content, language="python")
    end = time.perf_counter()
    print(f"Python Average: {(end - start) / 5:.4f}s")

    print(f"Benchmarking JS chunking ({len(js_content)/1024/1024:.2f} MB)...")
    start = time.perf_counter()
    for _ in range(5):
        chunker.chunk("test.js", js_content, language="javascript")
    end = time.perf_counter()
    print(f"JS Average: {(end - start) / 5:.4f}s")

if __name__ == "__main__":
    benchmark_chunking()
