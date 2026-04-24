/**
 * Parse each raw/<slug>.html -> normalized Markdown -> upsert into tips.db.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import * as cheerio from "cheerio";
import TurndownService from "turndown";
import { openDb, upsertTip, type TipRow } from "../src/db.js";

const RAW_DIR = new URL("../data/raw/", import.meta.url).pathname;
const BASE = "https://www.milanjovanovic.tech";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

interface MinimalElement {
  nodeName: string;
  textContent: string | null;
  querySelector?: (sel: string) => MinimalElement | null;
  getAttribute?: (name: string) => string | null;
}

turndown.addRule("pre-code-fence", {
  filter: (node) => {
    const el = node as unknown as MinimalElement;
    return el.nodeName === "PRE" && !!el.querySelector?.("code");
  },
  replacement: (_content, node) => {
    const el = node as unknown as MinimalElement;
    const code = el.querySelector?.("code") ?? null;
    const text = code?.textContent ?? el.textContent ?? "";
    const langClass = code?.getAttribute?.("class") ?? "";
    const langMatch = /language-([\w+-]+)/.exec(langClass);
    const lang = langMatch ? langMatch[1] : "";
    return `\n\n\`\`\`${lang}\n${text.replace(/\n$/, "")}\n\`\`\`\n\n`;
  },
});

interface Parsed {
  title: string;
  published: string;
  excerpt: string | null;
  contentMd: string;
  tags: string[];
}

function parseHtml(html: string, slug: string): Parsed | null {
  const $ = cheerio.load(html);

  const title =
    $('meta[property="og:title"]').attr("content")?.trim() ??
    $("article h1").first().text().trim() ??
    $("h1").first().text().trim() ??
    "";
  if (!title) return null;

  let published =
    $('meta[property="article:published_time"]').attr("content") ??
    $("time[datetime]").first().attr("datetime") ??
    "";
  if (!published) {
    const txt = $("time").first().text().trim();
    const d = txt ? new Date(txt) : null;
    if (d && !isNaN(d.getTime())) published = d.toISOString();
  }
  if (!published) published = new Date(0).toISOString();

  const excerpt =
    $('meta[name="description"]').attr("content")?.trim() ??
    $('meta[property="og:description"]').attr("content")?.trim() ??
    null;

  const tags = new Set<string>();
  $('meta[property="article:tag"]').each((_, el) => {
    const v = $(el).attr("content")?.trim();
    if (v) tags.add(v);
  });
  $('meta[name="keywords"]').each((_, el) => {
    const v = $(el).attr("content");
    if (!v) return;
    v.split(",").forEach((t) => {
      const x = t.trim();
      if (x) tags.add(x);
    });
  });

  let article = $("article").first();
  if (article.length === 0) article = $("main").first();
  if (article.length === 0) article = $("body");

  article.find("nav, header, footer, aside, script, style, form, noscript").remove();
  article.find('[class*="newsletter"], [class*="subscribe"], [class*="cta"]').remove();

  const contentHtml = article.html() ?? "";
  let contentMd = turndown.turndown(contentHtml);
  contentMd = contentMd.replace(/\n{3,}/g, "\n\n").trim();
  if (contentMd.length < 120) return null;

  return {
    title,
    published,
    excerpt,
    contentMd,
    tags: [...tags],
  };
}

function classifySource(slug: string, tags: string[]): "blog" | "newsletter" {
  const tagMatch = tags.some((t) => /weekly|newsletter/i.test(t));
  if (tagMatch) return "newsletter";
  if (/^(the-)?net-weekly/i.test(slug)) return "newsletter";
  return "blog";
}

function main(): void {
  const db = openDb();
  const files = readdirSync(RAW_DIR).filter((f) => f.endsWith(".html"));
  console.error(`ingesting ${files.length} raw files`);

  let ok = 0;
  let skip = 0;

  const tx = db.transaction((rows: TipRow[]) => {
    for (const r of rows) upsertTip(db, r);
  });

  const batch: TipRow[] = [];
  const BATCH_SIZE = 50;

  for (const file of files) {
    const slug = file.replace(/\.html$/, "");
    const path = join(RAW_DIR, file);
    if (statSync(path).size < 500) {
      skip++;
      continue;
    }
    const html = readFileSync(path, "utf8");
    const parsed = parseHtml(html, slug);
    if (!parsed) {
      skip++;
      continue;
    }
    const row: TipRow = {
      slug,
      title: parsed.title,
      url: `${BASE}/blog/${slug}`,
      source: classifySource(slug, parsed.tags),
      published: parsed.published,
      tags: parsed.tags,
      excerpt: parsed.excerpt,
      contentMd: parsed.contentMd,
    };
    batch.push(row);
    if (batch.length >= BATCH_SIZE) {
      tx(batch);
      ok += batch.length;
      batch.length = 0;
    }
  }
  if (batch.length > 0) {
    tx(batch);
    ok += batch.length;
  }

  const [{ n }] = db
    .prepare("SELECT COUNT(*) AS n FROM tips")
    .all() as { n: number }[];
  console.error(`upserted ${ok}, skipped ${skip}. total tips in db: ${n}`);
  db.close();
}

main();
