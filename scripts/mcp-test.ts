/**
 * Spawn the built MCP server, seed a test DB, send initialize + tools/list +
 * tools/call(search_tips), and assert the response.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, upsertTip } from "../src/db.js";

const tmp = mkdtempSync(join(tmpdir(), "milan-tips-mcp-"));
const dbPath = join(tmp, "mcp.db");
mkdirSync(tmp, { recursive: true });

{
  const db = openDb(dbPath);
  upsertTip(db, {
    slug: "fixture-outbox",
    title: "Fixture: Outbox Pattern",
    url: "https://example.invalid/outbox",
    source: "blog",
    published: "2024-01-10T00:00:00Z",
    tags: ["architecture"],
    excerpt: "Placeholder fixture.",
    contentMd: "Placeholder fixture about the outbox pattern.",
  });
  db.close();
}

const entry = new URL("../dist/src/server.js", import.meta.url).pathname;
const child = spawn("node", [entry], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, MILAN_TIPS_DB: dbPath },
});

let stderr = "";
child.stderr.on("data", (d) => (stderr += d.toString()));

const buf: string[] = [];
child.stdout.on("data", (d) => buf.push(d.toString()));

function send(obj: unknown): void {
  child.stdin.write(JSON.stringify(obj) + "\n");
}

async function readMessage(id: number, timeoutMs = 3000): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const joined = buf.join("");
    const lines = joined.split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id === id) return msg;
      } catch {
        /* partial line */
      }
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timeout waiting for id=${id}. stderr=${stderr}`);
}

async function main(): Promise<void> {
  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "mcp-test", version: "0.0.0" },
    },
  });
  const init = await readMessage(1);
  if (!init.result) throw new Error(`initialize failed: ${JSON.stringify(init)}`);
  console.log("PASS initialize");

  send({ jsonrpc: "2.0", method: "notifications/initialized" });

  send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const list = await readMessage(2);
  const names = list.result?.tools?.map((t: any) => t.name) ?? [];
  if (!names.includes("search_tips"))
    throw new Error(`tools/list missing search_tips: ${JSON.stringify(list)}`);
  console.log(`PASS tools/list -> ${names.join(", ")}`);

  send({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "search_tips", arguments: { query: "outbox", limit: 5 } },
  });
  const call = await readMessage(3);
  const text = call.result?.content?.[0]?.text ?? "";
  if (!text.includes("Outbox"))
    throw new Error(`tools/call missing expected hit: ${JSON.stringify(call)}`);
  console.log(`PASS tools/call -> ${text.slice(0, 80).replace(/\n/g, " ")}…`);
}

main()
  .then(() => {
    child.kill();
    rmSync(tmp, { recursive: true, force: true });
    console.log("mcp-test OK");
    process.exit(0);
  })
  .catch((err) => {
    child.kill();
    rmSync(tmp, { recursive: true, force: true });
    console.error(err);
    console.error("stderr:", stderr);
    process.exit(1);
  });
