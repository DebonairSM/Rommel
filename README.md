# Rommel — Milan Jovanović Tips MCP Server

A local MCP server that makes the last ~5 years of
[Milan Jovanović](https://www.milanjovanovic.tech/)'s .NET & software
architecture tips searchable by any MCP client (Claude Code, Cursor, Claude
Desktop, etc.).

Content is stored locally in SQLite with an FTS5 full-text index. The MCP
server exposes one tool, **`search_tips(query, limit?)`**, which returns
ranked hits with title, URL, publish date, source, and a highlighted snippet
so consuming agents can cite the original article.

## Layout

```
scripts/
  fetch-index.ts   # enumerate blog URLs (sitemap → fallback to /blog pages)
  fetch-posts.ts   # polite concurrent download of each post HTML
  ingest.ts        # parse HTML → Markdown → upsert into SQLite
  smoke-test.ts    # fixture-only test of the DB + FTS pipeline
  mcp-test.ts      # end-to-end MCP handshake + tools/call
src/
  db.ts            # schema, migrations, upsert
  search.ts        # FTS5 query builder + bm25 ranking
  server.ts        # MCP stdio server
  types.ts
data/
  tips.db          # generated; gitignored
  raw/             # cached post HTML; gitignored
```

## Setup

```bash
npm install
npm run build
```

## Populate the database

**Requires network access to `https://www.milanjovanovic.tech`**. The site is
fronted by Cloudflare, so run this on a normal developer machine, not inside
a locked-down CI sandbox. Re-running is idempotent — already-fetched posts
are skipped.

```bash
npm run ingest          # enumerate + fetch + parse
sqlite3 data/tips.db "SELECT COUNT(*) FROM tips;"
```

If the sitemap and `/blog` listing are both blocked in your environment, the
scripts will log `403` responses. In that case switch to a machine with
ordinary outbound HTTPS and re-run.

## Verify without network access

The smoke test seeds placeholder rows and confirms FTS ranking works:

```bash
npm run smoke
```

End-to-end MCP handshake + `tools/call`:

```bash
npm run mcp-test
```

## Wire into Claude Code

```bash
claude mcp add milan-tips -- node /absolute/path/to/Rommel/dist/src/server.js
```

Then in a session:

> Use `search_tips` to find entries about the outbox pattern.

The tool returns a Markdown list of `title / date / source / URL / snippet`,
which the agent can cite back to the reader.

## Environment variables

- `MILAN_TIPS_DB` — override the SQLite path (default: `./data/tips.db`).

## Notes on content use

The local corpus is for personal / agent-assisted reading only. Every record
retains author, source URL, and publish date so that anything the agent
surfaces can be cited back to [milanjovanovic.tech](https://www.milanjovanovic.tech/).
