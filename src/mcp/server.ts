import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Extractor } from "../extraction/types.js";
import type { TemporalGraphStore } from "../db/store.js";
import { recall, remember } from "../pipeline.js";

/**
 * Build the Tense MCP server over a store + extractor. Slice 01 exposes
 * `remember` and `recall`; `recall(as_of?)` and `history` arrive in slices 09/10.
 *
 * Tool results are returned as JSON text content so any MCP client can read them
 * and so the Inspector CLI round-trip is inspectable.
 */
export function createMcpServer(store: TemporalGraphStore, extractor: Extractor): McpServer {
  const server = new McpServer({ name: "tense", version: "0.1.0" });

  server.registerTool(
    "remember",
    {
      title: "Remember",
      description:
        "Ingest a chunk of text as a Source: extract Facts, resolve Entities, and " +
        "supersede any prior Fact on a single-valued Predicate. Returns the Facts " +
        "created and superseded.",
      inputSchema: {
        text: z.string().min(1).describe("The text to remember."),
        source: z.string().optional().describe("Optional label for the Source (e.g. a filename)."),
      },
    },
    async ({ text, source }) => {
      const summary = await remember(store, extractor, text, source ?? null);
      return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
    },
  );

  server.registerTool(
    "recall",
    {
      title: "Recall",
      description:
        "Return Current Facts matching the query, each with its Source citation " +
        "and validity interval.",
      inputSchema: {
        query: z.string().describe("What to recall. Empty returns all Current Facts."),
      },
    },
    async ({ query }) => {
      const facts = await recall(store, query);
      return { content: [{ type: "text", text: JSON.stringify(facts, null, 2) }] };
    },
  );

  return server;
}
