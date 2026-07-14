import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { app } from "electron";
import initSqlJs from "sql.js";
import type { Database, SqlJsStatic } from "sql.js";
import type {
  BookDetail,
  BookSummary,
  Chapter,
  ProgressRecord,
  ReaderSettings,
  SaveProgressInput
} from "../../src/shared/types";
import type { ParsedBook } from "./txt";

const requireFromMain = createRequire(__filename);

const DEFAULT_SETTINGS: ReaderSettings = {
  fontSize: 20,
  lineHeight: 1.85,
  theme: "paper",
  voiceURI: "",
  rate: 1,
  pitch: 1,
  volume: 0.9,
  autoNext: true
};

type SqlRow = Record<string, unknown>;

function nowIso(): string {
  return new Date().toISOString();
}

function toText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function toNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolveSqlWasmDir(): string {
  const resolved = requireFromMain.resolve("sql.js/dist/sql-wasm.wasm");
  const unpacked = app.isPackaged ? resolved.replace("app.asar", "app.asar.unpacked") : resolved;
  return path.dirname(unpacked);
}

function mapProgress(row: SqlRow, bookId: string): ProgressRecord {
  return {
    bookId,
    chapterIndex: toNumber(row.chapter_index),
    scrollTop: toNumber(row.scroll_top),
    percent: toNumber(row.percent),
    updatedAt: toText(row.progress_updated_at, toText(row.updated_at, nowIso()))
  };
}

function mapBook(row: SqlRow): BookSummary {
  const id = toText(row.id);

  return {
    id,
    title: toText(row.title, "未命名小说"),
    filePath: toText(row.file_path),
    encoding: toText(row.encoding, "utf8"),
    totalChapters: toNumber(row.total_chapters),
    totalChars: toNumber(row.total_chars),
    createdAt: toText(row.created_at),
    updatedAt: toText(row.updated_at),
    progress: mapProgress(row, id)
  };
}

function mapChapter(row: SqlRow): Chapter {
  return {
    id: toText(row.id),
    bookId: toText(row.book_id),
    index: toNumber(row.chapter_index),
    title: toText(row.title, "正文"),
    content: toText(row.content),
    charCount: toNumber(row.char_count)
  };
}

export class NovelDatabase {
  private readonly dbPath: string;
  private sql: SqlJsStatic | null = null;
  private db: Database | null = null;

  constructor(userDataPath: string) {
    this.dbPath = path.join(userDataPath, "novel-reader.sqlite");
  }

  async init(): Promise<void> {
    await fs.promises.mkdir(path.dirname(this.dbPath), { recursive: true });

    this.sql = await initSqlJs({
      locateFile: (fileName: string) => path.join(resolveSqlWasmDir(), fileName)
    });

    if (fs.existsSync(this.dbPath)) {
      const buffer = await fs.promises.readFile(this.dbPath);
      this.db = new this.sql.Database(new Uint8Array(buffer));
    } else {
      this.db = new this.sql.Database();
    }

    this.migrate();
    this.persist();
  }

  close(): void {
    if (!this.db) {
      return;
    }

    this.persist();
    this.db.close();
    this.db = null;
  }

  listBooks(): BookSummary[] {
    return this.selectBooks("ORDER BY b.updated_at DESC");
  }

  getBook(bookId: string): BookDetail {
    const [summary] = this.selectBooks("WHERE b.id = ? LIMIT 1", [bookId]);

    if (!summary) {
      throw new Error("没有找到这本小说。");
    }

    const chapters = this.all<Chapter>(
      `SELECT id, book_id, chapter_index, title, content, char_count
       FROM chapters
       WHERE book_id = ?
       ORDER BY chapter_index ASC`,
      [bookId],
      mapChapter
    );

    return {
      ...summary,
      chapters,
      progress: summary.progress
    };
  }

  upsertBook(parsed: ParsedBook): BookSummary {
    const existing = this.first<SqlRow>("SELECT id, created_at FROM books WHERE file_path = ? LIMIT 1", [
      parsed.filePath
    ]);

    const bookId = existing ? toText(existing.id) : randomUUID();
    const createdAt = existing ? toText(existing.created_at, nowIso()) : nowIso();
    const updatedAt = nowIso();

    this.transaction(() => {
      this.run(
        `INSERT INTO books (id, title, file_path, encoding, total_chars, total_chapters, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(file_path) DO UPDATE SET
           title = excluded.title,
           encoding = excluded.encoding,
           total_chars = excluded.total_chars,
           total_chapters = excluded.total_chapters,
           updated_at = excluded.updated_at`,
        [
          bookId,
          parsed.title,
          parsed.filePath,
          parsed.encoding,
          parsed.totalChars,
          parsed.chapters.length,
          createdAt,
          updatedAt
        ]
      );

      this.run("DELETE FROM chapters WHERE book_id = ?", [bookId]);

      for (const chapter of parsed.chapters) {
        this.run(
          `INSERT INTO chapters (id, book_id, chapter_index, title, content, char_count)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            randomUUID(),
            bookId,
            chapter.index,
            chapter.title,
            chapter.content,
            chapter.charCount
          ]
        );
      }

      this.run(
        `INSERT INTO progress (book_id, chapter_index, scroll_top, percent, updated_at)
         VALUES (?, 0, 0, 0, ?)
         ON CONFLICT(book_id) DO NOTHING`,
        [bookId, updatedAt]
      );
    });

    return this.getBook(bookId);
  }

  deleteBook(bookId: string): void {
    this.run("DELETE FROM books WHERE id = ?", [bookId]);
    this.persist();
  }

  updateProgress(input: SaveProgressInput): ProgressRecord {
    const detail = this.getBook(input.bookId);
    const maxChapter = Math.max(0, detail.chapters.length - 1);
    const chapterIndex = clamp(Math.round(input.chapterIndex), 0, maxChapter);
    const updatedAt = nowIso();

    const progress: ProgressRecord = {
      bookId: input.bookId,
      chapterIndex,
      scrollTop: Math.max(0, input.scrollTop),
      percent: clamp(input.percent, 0, 100),
      updatedAt
    };

    this.run(
      `INSERT INTO progress (book_id, chapter_index, scroll_top, percent, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(book_id) DO UPDATE SET
         chapter_index = excluded.chapter_index,
         scroll_top = excluded.scroll_top,
         percent = excluded.percent,
         updated_at = excluded.updated_at`,
      [progress.bookId, progress.chapterIndex, progress.scrollTop, progress.percent, progress.updatedAt]
    );

    this.run("UPDATE books SET updated_at = ? WHERE id = ?", [updatedAt, input.bookId]);
    this.persist();
    return progress;
  }

  getSettings(): ReaderSettings {
    const row = this.first<SqlRow>("SELECT value FROM settings WHERE key = 'reader' LIMIT 1");

    if (!row) {
      return { ...DEFAULT_SETTINGS };
    }

    try {
      const parsed = JSON.parse(toText(row.value));
      return { ...DEFAULT_SETTINGS, ...parsed };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  saveSettings(settings: ReaderSettings): ReaderSettings {
    const next: ReaderSettings = {
      ...DEFAULT_SETTINGS,
      ...settings,
      fontSize: clamp(settings.fontSize, 14, 34),
      lineHeight: clamp(settings.lineHeight, 1.3, 2.4),
      rate: clamp(settings.rate, 0.5, 2),
      pitch: clamp(settings.pitch, 0.5, 2),
      volume: clamp(settings.volume, 0, 1)
    };

    this.run(
      `INSERT INTO settings (key, value)
       VALUES ('reader', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [JSON.stringify(next)]
    );
    this.persist();
    return next;
  }

  private migrate(): void {
    this.ensureDb().run("PRAGMA foreign_keys = ON");
    this.ensureDb().run(`
      CREATE TABLE IF NOT EXISTS books (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        file_path TEXT NOT NULL UNIQUE,
        encoding TEXT NOT NULL,
        total_chars INTEGER NOT NULL DEFAULT 0,
        total_chapters INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    this.ensureDb().run(`
      CREATE TABLE IF NOT EXISTS chapters (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL,
        chapter_index INTEGER NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        char_count INTEGER NOT NULL DEFAULT 0,
        UNIQUE(book_id, chapter_index),
        FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
      );
    `);
    this.ensureDb().run(`
      CREATE TABLE IF NOT EXISTS progress (
        book_id TEXT PRIMARY KEY,
        chapter_index INTEGER NOT NULL DEFAULT 0,
        scroll_top REAL NOT NULL DEFAULT 0,
        percent REAL NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
      );
    `);
    this.ensureDb().run(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  private selectBooks(whereClause = "", params: unknown[] = []): BookSummary[] {
    return this.all<BookSummary>(
      `SELECT
         b.id,
         b.title,
         b.file_path,
         b.encoding,
         b.total_chars,
         b.total_chapters,
         b.created_at,
         b.updated_at,
         COALESCE(p.chapter_index, 0) AS chapter_index,
         COALESCE(p.scroll_top, 0) AS scroll_top,
         COALESCE(p.percent, 0) AS percent,
         COALESCE(p.updated_at, b.updated_at) AS progress_updated_at
       FROM books b
       LEFT JOIN progress p ON p.book_id = b.id
       ${whereClause}`,
      params,
      mapBook
    );
  }

  private transaction(work: () => void): void {
    const db = this.ensureDb();
    db.run("BEGIN TRANSACTION");

    try {
      work();
      db.run("COMMIT");
      this.persist();
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }
  }

  private run(sql: string, params: unknown[] = []): void {
    this.ensureDb().run(sql, params);
  }

  private first<T>(sql: string, params: unknown[] = [], mapper?: (row: SqlRow) => T): T | null {
    return this.all<T>(sql, params, mapper)[0] ?? null;
  }

  private all<T>(sql: string, params: unknown[] = [], mapper?: (row: SqlRow) => T): T[] {
    const statement = this.ensureDb().prepare(sql);
    const rows: T[] = [];

    try {
      statement.bind(params);

      while (statement.step()) {
        const row = statement.getAsObject();
        rows.push(mapper ? mapper(row) : (row as T));
      }
    } finally {
      statement.free();
    }

    return rows;
  }

  private persist(): void {
    const data = this.ensureDb().export();
    fs.writeFileSync(this.dbPath, Buffer.from(data));
  }

  private ensureDb(): Database {
    if (!this.db) {
      throw new Error("数据库尚未初始化。");
    }

    return this.db;
  }
}
