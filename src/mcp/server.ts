import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { recall, remember, type RememberDeps } from "../pipeline.js";

/**
 * Build the Tense MCP server over the ingest dependencies. Slice 01 exposed
 * `remember`/`recall`; slices 09/10 add `recall(as_of?)` and `history`.
 *
 * Tool results are JSON text so any MCP client can read them and the Inspector
 * CLI round-trip is inspectable. Errors are returned as `isError` results rather
 * than thrown, so a bad extraction never takes the server down.
 */
export function createMcpServer(deps: RememberDeps): McpServer {
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
      try {
        const summary = await remember(deps, text, source ?? null);
        return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `remember failed: ${message}` }],
          isError: true,
        };
      }
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
      const facts = await recall(deps.store, query);
      return { content: [{ type: "text", text: JSON.stringify(facts, null, 2) }] };
    },
  );

  return server;
}
