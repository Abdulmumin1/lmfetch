"""SQLite-based cache for file metadata, chunks, and embeddings."""

import json
import sqlite3
import time
from dataclasses import asdict
from pathlib import Path
from typing import Any

from .chunkers.base import Chunk


class SQLiteCache:
    def __init__(self, db_path: Path | None = None):
        self.db_path = db_path or Path.home() / ".cache" / "lmfetch" / "cache.db"
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _init_db(self):
        """Initialize the database schema."""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS files (
                    path TEXT PRIMARY KEY,
                    hash TEXT NOT NULL,
                    mtime REAL NOT NULL,
                    size INTEGER NOT NULL,
                    last_accessed REAL NOT NULL,
                    language TEXT
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS chunks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    file_path TEXT NOT NULL,
                    content TEXT NOT NULL,
                    start_line INTEGER,
                    end_line INTEGER,
                    chunk_type TEXT,
                    name TEXT,
                    embedding BLOB,  -- JSON serialized list[float]
                    FOREIGN KEY(file_path) REFERENCES files(path) ON DELETE CASCADE
                )
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_path)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_files_access ON files(last_accessed)")

    def get_file(self, path: str, current_hash: str) -> list[Chunk] | None:
        """Get cached chunks for a file if hash matches."""
        with sqlite3.connect(self.db_path) as conn:
            # Update access time
            conn.execute(
                "UPDATE files SET last_accessed = ? WHERE path = ?",
                (time.time(), path),
            )
            
            # Check metadata
            row = conn.execute(
                "SELECT hash, language FROM files WHERE path = ?", (path,)
            ).fetchone()
            
            if not row or row[0] != current_hash:
                return None

            language = row[1]
            
            # Get chunks
            cursor = conn.execute(
                """
                SELECT content, start_line, end_line, chunk_type, name 
                FROM chunks WHERE file_path = ? ORDER BY start_line
                """,
                (path,),
            )
            chunks = []
            for r in cursor:
                chunks.append(Chunk(
                    path=path,
                    content=r[0],
                    start_line=r[1],
                    end_line=r[2],
                    chunk_type=r[3],
                    name=r[4],
                    language=language
                ))
            return chunks

    def save_file(self, path: str, file_hash: str, mtime: float, size: int, language: str | None, chunks: list[Chunk]):
        """Save file metadata and chunks to cache."""
        with sqlite3.connect(self.db_path) as conn:
            # Upsert file
            conn.execute(
                """
                INSERT OR REPLACE INTO files (path, hash, mtime, size, last_accessed, language)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (path, file_hash, mtime, size, time.time(), language),
            )
            
            # Delete old chunks
            conn.execute("DELETE FROM chunks WHERE file_path = ?", (path,))
            
            # Insert new chunks
            data = [
                (
                    path,
                    c.content,
                    c.start_line,
                    c.end_line,
                    c.chunk_type,
                    c.name,
                    None, # Embedding (cached separately/later in this design, but slot reserved)
                )
                for c in chunks
            ]
            conn.executemany(
                """
                INSERT INTO chunks (file_path, content, start_line, end_line, chunk_type, name, embedding)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                data,
            )

    def prune(self, max_age_days: int = 30):
        """Remove entries older than max_age_days."""
        cutoff = time.time() - (max_age_days * 86400)
        with sqlite3.connect(self.db_path) as conn:
            # Enable foreign keys for cascade delete
            conn.execute("PRAGMA foreign_keys = ON")
            conn.execute("DELETE FROM files WHERE last_accessed < ?", (cutoff,))
            return conn.total_changes

    def clear(self):
        """Wipe the entire cache."""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("DELETE FROM chunks")
            conn.execute("DELETE FROM files")
