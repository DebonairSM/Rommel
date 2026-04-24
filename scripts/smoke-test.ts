/**
 * End-to-end smoke test for the DB + FTS + search pipeline.
 * Inserts a handful of *placeholder* rows (clearly labeled as fixtures, not
 * Milan's actual words) and runs a search query to verify ranking works.
 * Uses a throwaway DB path so the real tips.db is untouched.
 */
import { rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, upsertTip, type TipRow } from "../src/db.js";
import { searchTips } from "../src/search.js";

const FIXTURES: TipRow[] = [
  {
    slug: "fixture-outbox",
    title: "Fixture: Outbox Pattern",
    url: "https://example.invalid/outbox",
    source: "blog",
    published: "2024-01-10T00:00:00Z",
    tags: ["architecture", "messaging"],
    excerpt: "Placeholder fixture row for smoke testing FTS.",
    contentMd:
      "This is a placeholder fixture discussing the outbox pattern, transactional messaging, and eventual consistency. Not real content.",
  },
  {
    slug: "fixture-ef-core-nplus1",
    title: "Fixture: EF Core N+1 Pitfalls",
    url: "https://example.invalid/ef-core-nplus1",
    source: "blog",
    published: "2024-03-02T00:00:00Z",
    tags: ["ef-core", "performance"],
    excerpt: "Placeholder fixture row for smoke testing FTS.",
    contentMd:
      "Placeholder fixture about lazy loading, projection, and AsNoTracking in EF Core. Not real content.",
  },
  {
    slug: "fixture-cqrs-mediatr",
    title: "Fixture: CQRS with MediatR",
    url: "https://example.invalid/cqrs-mediatr",
    source: "newsletter",
    published: "2023-11-22T00:00:00Z",
    tags: ["cqrs", "mediatr", "ddd"],
    excerpt: "Placeholder fixture row for smoke testing FTS.",
    contentMd:
      "Placeholder fixture about commands, queries, pipeline behaviors, and validation with MediatR. Not real content.",
  },
];

function main(): void {
  const dir = mkdtempSync(join(tmpdir(), "milan-tips-smoke-"));
  const dbPath = join(dir, "smoke.db");
  const db = openDb(dbPath);

  for (const row of FIXTURES) upsertTip(db, row);

  const cases = [
    { q: "outbox", expectTitle: "Fixture: Outbox Pattern" },
    { q: "EF Core", expectTitle: "Fixture: EF Core N+1 Pitfalls" },
    { q: "mediatr cqrs", expectTitle: "Fixture: CQRS with MediatR" },
  ];

  let failed = 0;
  for (const c of cases) {
    const hits = searchTips(db, c.q, 3);
    const top = hits[0]?.title ?? "(none)";
    const ok = top === c.expectTitle;
    console.log(
      `${ok ? "PASS" : "FAIL"}  query="${c.q}"  top="${top}"  (${hits.length} hits)`
    );
    if (!ok) failed++;
  }

  db.close();
  rmSync(dir, { recursive: true, force: true });

  if (failed > 0) {
    console.error(`${failed} assertion(s) failed`);
    process.exit(1);
  }
  console.log("smoke test OK");
}

main();
