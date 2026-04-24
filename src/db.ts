import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DEFAULT_DB_PATH = new URL("../data/tips.db", import.meta.url).pathname;

export function defaultDbPath(): string {
  return process.env.MILAN_TIPS_DB ?? DEFAULT_DB_PATH;
}

export function openDb(path: string = defaultDbPath()): Database.Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tips (
      id          INTEGER PRIMARY KEY,
      slug        TEXT UNIQUE NOT NULL,
      title       TEXT NOT NULL,
      url         TEXT NOT NULL,
      source      TEXT NOT NULL CHECK (source IN ('blog','newsletter')),
      published   TEXT NOT NULL,
      tags        TEXT,
      excerpt     TEXT,
      content_md  TEXT NOT NULL,
      fetched_at  TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS tips_fts USING fts5(
      title, excerpt, content_md, tags,
      content='tips', content_rowid='id',
      tokenize='porter unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS tips_ai AFTER INSERT ON tips BEGIN
      INSERT INTO tips_fts(rowid, title, excerpt, content_md, tags)
      VALUES (new.id, new.title, new.excerpt, new.content_md, new.tags);
    END;

    CREATE TRIGGER IF NOT EXISTS tips_ad AFTER DELETE ON tips BEGIN
      INSERT INTO tips_fts(tips_fts, rowid, title, excerpt, content_md, tags)
      VALUES ('delete', old.id, old.title, old.excerpt, old.content_md, old.tags);
    END;

    CREATE TRIGGER IF NOT EXISTS tips_au AFTER UPDATE ON tips BEGIN
      INSERT INTO tips_fts(tips_fts, rowid, title, excerpt, content_md, tags)
      VALUES ('delete', old.id, old.title, old.excerpt, old.content_md, old.tags);
      INSERT INTO tips_fts(rowid, title, excerpt, content_md, tags)
      VALUES (new.id, new.title, new.excerpt, new.content_md, new.tags);
    END;
  `);
}

export interface TipRow {
  slug: string;
  title: string;
  url: string;
  source: "blog" | "newsletter";
  published: string;
  tags: string[];
  excerpt: string | null;
  contentMd: string;
}

export function upsertTip(db: Database.Database, t: TipRow): void {
  const stmt = db.prepare(`
    INSERT INTO tips (slug, title, url, source, published, tags, excerpt, content_md, fetched_at)
    VALUES (@slug, @title, @url, @source, @published, @tags, @excerpt, @content_md, @fetched_at)
    ON CONFLICT(slug) DO UPDATE SET
      title = excluded.title,
      url = excluded.url,
      source = excluded.source,
      published = excluded.published,
      tags = excluded.tags,
      excerpt = excluded.excerpt,
      content_md = excluded.content_md,
      fetched_at = excluded.fetched_at;
  `);
  stmt.run({
    slug: t.slug,
    title: t.title,
    url: t.url,
    source: t.source,
    published: t.published,
    tags: JSON.stringify(t.tags),
    excerpt: t.excerpt,
    content_md: t.contentMd,
    fetched_at: new Date().toISOString(),
  });
}
