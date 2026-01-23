/**
 * SQLite-based caching system using Bun's native SQLite
 */
import { Database } from "bun:sqlite";
import { getCacheDir, hashContent } from "./utils";
import { mkdir } from "fs/promises";
import { join } from "path";
import type { Chunk } from "./chunkers/types";

const CACHE_DIR = getCacheDir();
const DB_PATH = join(CACHE_DIR, "cache.db");
const CACHE_TTL_DAYS = 30;

interface FileRecord {
  path: string;
  hash: string;
  mtime: number;
  size: number;
  last_accessed: number;
  language: string;
}

interface ChunkRecord {
  id: number;
  file_path: string;
  content: string;
  start_line: number;
  end_line: number;
  chunk_type: string;
  name: string | null;
}

export class Cache {
  private db: Database;
  private initialized = false;

  constructor() {
    this.db = null as unknown as Database;
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    // Ensure cache directory exists
    await mkdir(CACHE_DIR, { recursive: true });

    this.db = new Database(DB_PATH, { create: true });

    // Create tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY,
        hash TEXT NOT NULL,
        mtime REAL NOT NULL,
        size INTEGER NOT NULL,
        last_accessed REAL NOT NULL,
        language TEXT
      );

      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL,
        content TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        chunk_type TEXT,
        name TEXT,
        FOREIGN KEY (file_path) REFERENCES files(path) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_path);
      CREATE INDEX IF NOT EXISTS idx_files_accessed ON files(last_accessed);
    `);

    // Prune old entries
    this.prune();

    this.initialized = true;
  }

  /**
   * Check if a file is cached and up to date
   */
  getFile(path: string, mtime: number): FileRecord | null {
    const stmt = this.db.prepare(
      "SELECT * FROM files WHERE path = ? AND mtime >= ?"
    );
    const record = stmt.get(path, mtime) as FileRecord | null;

    if (record) {
      // Update last accessed time
      this.db
        .prepare("UPDATE files SET last_accessed = ? WHERE path = ?")
        .run(Date.now(), path);
    }

    return record;
  }

  /**
   * Get cached chunks for a file
   */
  getChunks(filePath: string): ChunkRecord[] {
    const stmt = this.db.prepare("SELECT * FROM chunks WHERE file_path = ?");
    return stmt.all(filePath) as ChunkRecord[];
  }

  /**
   * Store a file record
   */
  setFile(
    path: string,
    content: string,
    mtime: number,
    language: string
  ): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO files (path, hash, mtime, size, last_accessed, language)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      path,
      hashContent(content),
      mtime,
      content.length,
      Date.now(),
      language
    );
  }

  /**
   * Store chunks for a file
   */
  setChunks(filePath: string, chunks: Chunk[]): void {
    // Delete existing chunks for this file
    this.db.prepare("DELETE FROM chunks WHERE file_path = ?").run(filePath);

    const stmt = this.db.prepare(`
      INSERT INTO chunks (file_path, content, start_line, end_line, chunk_type, name)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const chunk of chunks) {
      stmt.run(
        filePath,
        chunk.content,
        chunk.startLine,
        chunk.endLine,
        chunk.type,
        chunk.name || null
      );
    }
  }

  /**
   * Check if chunks are cached for a file
   */
  hasCachedChunks(filePath: string, mtime: number): boolean {
    const file = this.getFile(filePath, mtime);
    if (!file) return false;

    const stmt = this.db.prepare(
      "SELECT COUNT(*) as count FROM chunks WHERE file_path = ?"
    );
    const result = stmt.get(filePath) as { count: number };
    return result.count > 0;
  }

  /**
   * Prune old cache entries
   */
  prune(): void {
    const cutoff = Date.now() - CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
    this.db.prepare("DELETE FROM files WHERE last_accessed < ?").run(cutoff);
    // Chunks are deleted via ON DELETE CASCADE
  }

  /**
   * Clear all cache data
   */
  clear(): void {
    this.db.exec("DELETE FROM chunks; DELETE FROM files;");
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }
}

// Singleton instance
let cacheInstance: Cache | null = null;

export async function getCache(): Promise<Cache> {
  if (!cacheInstance) {
    cacheInstance = new Cache();
    await cacheInstance.init();
  }
  return cacheInstance;
}
