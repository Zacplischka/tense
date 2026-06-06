import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { remember, type RememberDeps } from "../pipeline.js";
import { recall } from "../retrieval/recall.js";
import { history } from "../retrieval/history.js";

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
        "Return ranked Facts matching the query — Current by default, or whatever " +
        "was Current at `as_of`. Each Fact includes its Source citation and " +
        "validity interval.",
      inputSchema: {
        query: z.string().describe("What to recall. Empty returns the temporally-filtered set."),
        as_of: z
          .string()
          .optional()
          .describe("ISO date/time; return Facts that were Current (valid) at that instant."),
      },
    },
    async ({ query, as_of }) => {
      const asOf = as_of ? new Date(as_of) : null;
      if (as_of && Number.isNaN(asOf!.getTime())) {
        return { content: [{ type: "text", text: `invalid as_of date: ${as_of}` }], isError: true };
      }
      const facts = await recall({ store: deps.store, provider: deps.provider }, query, { asOf });
      return { content: [{ type: "text", text: JSON.stringify(facts, null, 2) }] };
    },
  );

  server.registerTool(
    "history",
    {
      title: "History",
      description:
        "Return the full Supersession chain for a subject (past and present Facts), " +
        "optionally narrowed to one Predicate — each with its validity interval and " +
        "Source, in chronological order.",
      inputSchema: {
        entity: z.string().min(1).describe("The subject Entity name (variants are resolved)."),
        predicate: z.string().optional().describe("Optional Predicate to narrow the chain."),
      },
    },
    async ({ entity, predicate }) => {
      const chain = await history({ store: deps.store, resolver: deps.resolver }, entity, predicate);
      return { content: [{ type: "text", text: JSON.stringify(chain, null, 2) }] };
    },
  );

  return server;
}
