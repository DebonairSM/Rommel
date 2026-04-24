/**
 * Download each post HTML to data/raw/<slug>.html, idempotent and polite.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const UA =
  "Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0";
const HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
  Connection: "keep-alive",
  "Upgrade-Insecure-Requests": "1",
};

const CONCURRENCY = 3;
const JITTER_MS = 500;
const INDEX_PATH = new URL("../data/index.json", import.meta.url).pathname;
const RAW_DIR = new URL("../data/raw/", import.meta.url).pathname;

interface IndexEntry {
  url: string;
  slug: string;
  lastmod?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchOne(entry: IndexEntry): Promise<"ok" | "skip" | "fail"> {
  const out = join(RAW_DIR, `${entry.slug}.html`);
  if (existsSync(out)) return "skip";
  try {
    const res = await fetch(entry.url, { headers: HEADERS, redirect: "follow" });
    if (!res.ok) {
      console.error(`  ${entry.slug} -> ${res.status}`);
      return "fail";
    }
    const html = await res.text();
    writeFileSync(out, html);
    return "ok";
  } catch (err) {
    console.error(`  ${entry.slug} -> ${(err as Error).message}`);
    return "fail";
  }
}

async function main(): Promise<void> {
  if (!existsSync(INDEX_PATH)) {
    console.error(`missing ${INDEX_PATH}; run ingest:index first`);
    process.exit(1);
  }
  mkdirSync(RAW_DIR, { recursive: true });
  const entries: IndexEntry[] = JSON.parse(readFileSync(INDEX_PATH, "utf8"));
  console.error(`fetching ${entries.length} posts (concurrency=${CONCURRENCY})`);

  const queue = [...entries];
  let ok = 0;
  let skip = 0;
  let fail = 0;

  async function worker(id: number): Promise<void> {
    while (queue.length > 0) {
      const e = queue.shift()!;
      const result = await fetchOne(e);
      if (result === "ok") ok++;
      else if (result === "skip") skip++;
      else fail++;
      if (result === "ok") {
        await sleep(JITTER_MS + Math.random() * JITTER_MS);
      }
      if ((ok + skip + fail) % 25 === 0) {
        console.error(`  progress ok=${ok} skip=${skip} fail=${fail}`);
      }
    }
  }

  await Promise.all(
    Array.from({ length: CONCURRENCY }, (_, i) => worker(i))
  );
  console.error(`done ok=${ok} skip=${skip} fail=${fail}`);
  if (fail > 0 && ok === 0) process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
