import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { openDb } from "./db.js";
import { searchTips } from "./search.js";

const SearchInput = z.object({
  query: z.string().min(1, "query must not be empty"),
  limit: z.number().int().min(1).max(50).default(10),
});

async function main(): Promise<void> {
  const db = openDb();

  const server = new Server(
    { name: "milan-tips", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "search_tips",
        description:
          "Search Milan Jovanović's .NET / architecture tips (blog + The .NET Weekly) " +
          "by keyword. Returns title, URL, publish date, and a highlighted snippet.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                "Keywords to search for, e.g. 'EF Core N+1', 'outbox pattern', 'CQRS MediatR'.",
            },
            limit: {
              type: "number",
              description: "Maximum number of hits to return (1-50).",
              default: 10,
              minimum: 1,
              maximum: 50,
            },
          },
          required: ["query"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (req.params.name !== "search_tips") {
      throw new Error(`Unknown tool: ${req.params.name}`);
    }
    const { query, limit } = SearchInput.parse(req.params.arguments ?? {});
    const hits = searchTips(db, query, limit);
    if (hits.length === 0) {
      return {
        content: [
          { type: "text", text: `No tips found for "${query}".` },
        ],
      };
    }
    const lines = hits.map((h, i) => {
      const date = h.published.slice(0, 10);
      return `${i + 1}. **${h.title}** (${date}, ${h.source})\n   ${h.url}\n   ${h.snippet}`;
    });
    return {
      content: [
        {
          type: "text",
          text: `Found ${hits.length} tip(s) for "${query}":\n\n${lines.join("\n\n")}`,
        },
      ],
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("milan-tips MCP server ready on stdio");
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
