/**
 * Enumerate all blog post URLs from milanjovanovic.tech and save to data/index.json.
 *
 * Strategy:
 *   1. Try the sitemap index / sitemap-0.xml first.
 *   2. If that 403s or is missing, fall back to paginated /blog listing pages.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import * as cheerio from "cheerio";

const UA =
  "Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0";
const HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
  "Accept-Encoding": "gzip, deflate, br",
  Connection: "keep-alive",
  "Upgrade-Insecure-Requests": "1",
};

const BASE = "https://www.milanjovanovic.tech";
const SITEMAPS = [
  `${BASE}/sitemap-0.xml`,
  `${BASE}/sitemap.xml`,
  `${BASE}/sitemap-index.xml`,
];

const OUT_PATH = new URL("../data/index.json", import.meta.url).pathname;

interface IndexEntry {
  url: string;
  slug: string;
  lastmod?: string;
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: HEADERS, redirect: "follow" });
    if (!res.ok) {
      console.error(`  ${url} -> ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    console.error(`  ${url} -> ${(err as Error).message}`);
    return null;
  }
}

function parseSitemap(xml: string): IndexEntry[] {
  const entries: IndexEntry[] = [];
  const urlBlocks = xml.matchAll(/<url\b[\s\S]*?<\/url>/g);
  for (const match of urlBlocks) {
    const block = match[0];
    const loc = /<loc>([^<]+)<\/loc>/.exec(block)?.[1];
    const lastmod = /<lastmod>([^<]+)<\/lastmod>/.exec(block)?.[1];
    if (!loc) continue;
    if (!loc.includes("/blog/")) continue;
    if (loc.endsWith("/blog") || loc.endsWith("/blog/")) continue;
    const slug = loc.replace(/\/$/, "").split("/").pop()!;
    entries.push({ url: loc, slug, lastmod });
  }
  return entries;
}

async function fromSitemap(): Promise<IndexEntry[]> {
  for (const url of SITEMAPS) {
    console.error(`sitemap: trying ${url}`);
    const xml = await fetchText(url);
    if (!xml) continue;
    if (xml.includes("<sitemapindex")) {
      const children = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
      const all: IndexEntry[] = [];
      for (const child of children) {
        const childXml = await fetchText(child);
        if (childXml) all.push(...parseSitemap(childXml));
      }
      if (all.length > 0) return all;
    }
    const entries = parseSitemap(xml);
    if (entries.length > 0) return entries;
  }
  return [];
}

async function fromBlogIndex(): Promise<IndexEntry[]> {
  console.error("fallback: crawling /blog listing pages");
  const seen = new Map<string, IndexEntry>();
  for (let page = 1; page <= 40; page++) {
    const url = page === 1 ? `${BASE}/blog` : `${BASE}/blog?page=${page}`;
    const html = await fetchText(url);
    if (!html) break;
    const $ = cheerio.load(html);
    let found = 0;
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;
      const abs = href.startsWith("http") ? href : `${BASE}${href}`;
      if (!abs.startsWith(`${BASE}/blog/`)) return;
      const rest = abs.slice(`${BASE}/blog/`.length);
      if (!rest || rest.includes("?") || rest.includes("#")) return;
      const slug = rest.replace(/\/$/, "");
      if (!slug || slug.includes("/")) return;
      const cleanUrl = `${BASE}/blog/${slug}`;
      if (!seen.has(slug)) {
        seen.set(slug, { url: cleanUrl, slug });
        found++;
      }
    });
    console.error(`  page ${page}: +${found} (total ${seen.size})`);
    if (found === 0) break;
    await sleep(400);
  }
  return [...seen.values()];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  let entries = await fromSitemap();
  if (entries.length === 0) entries = await fromBlogIndex();

  entries = dedupe(entries);
  entries.sort((a, b) => a.slug.localeCompare(b.slug));

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(entries, null, 2));
  console.error(`wrote ${entries.length} entries -> ${OUT_PATH}`);
}

function dedupe(entries: IndexEntry[]): IndexEntry[] {
  const by = new Map<string, IndexEntry>();
  for (const e of entries) by.set(e.slug, e);
  return [...by.values()];
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
