import type Database from "better-sqlite3";
import type { SearchHit } from "./types.js";

export function sanitizeQuery(raw: string): string {
  const cleaned = raw
    .replace(/["'`]/g, " ")
    .replace(/[^\p{L}\p{N}\s\-+*]/gu, " ")
    .trim();
  if (!cleaned) return "";
  const tokens = cleaned.split(/\s+/).filter((t) => t.length >= 2);
  if (tokens.length === 0) return "";
  return tokens.map((t) => (t.endsWith("*") ? t : `${t}*`)).join(" ");
}

export function searchTips(
  db: Database.Database,
  query: string,
  limit: number
): SearchHit[] {
  const ftsQuery = sanitizeQuery(query);
  if (!ftsQuery) return [];
  const rows = db
    .prepare(
      `
      SELECT t.id         AS id,
             t.title      AS title,
             t.url        AS url,
             t.published  AS published,
             t.source     AS source,
             snippet(tips_fts, 2, '[', ']', '…', 24) AS snippet,
             bm25(tips_fts) AS score
      FROM tips_fts
      JOIN tips t ON t.id = tips_fts.rowid
      WHERE tips_fts MATCH ?
      ORDER BY score
      LIMIT ?;
      `
    )
    .all(ftsQuery, limit) as SearchHit[];
  return rows;
}
