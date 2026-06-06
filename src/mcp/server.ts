import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { remember, type RememberDeps } from "../pipeline.js";
import { previewRemember } from "../preview.js";
import { recall } from "../retrieval/recall.js";
import { history } from "../retrieval/history.js";

/**
 * Build the Tense MCP server over the ingest dependencies. Exposes the write/
 * preview path (`remember`, `preview`), the bi-temporal query surface (`recall`
 * by valid time, `changes` by transaction time, `history`), and introspection
 * (`stats`, `entities`, `sources`).
 *
 * Tool results are JSON text so any MCP client can read them and the Inspector
 * CLI round-trip is inspectable. Errors are returned as `isError` results rather
 * than thrown, so a bad extraction never takes the server down. The `jsonResult`
 * / `toolError` helpers keep that result shape in one place across the tools.
 */

/** A tool result whose body is the value pretty-printed as JSON text. */
function jsonResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

/** A tool error result carrying a plain message. */
function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

/** A tool error result for a thrown error: `<label> failed: <message>`. */
function toolError(label: string, err: unknown) {
  return errorResult(`${label} failed: ${err instanceof Error ? err.message : String(err)}`);
}

export function createMcpServer(deps: RememberDeps): McpServer {
  const server = new McpServer({ name: "tense", version: "0.1.0" });

  server.registerTool(
    "remember",
    {
      title: "Remember",
      description:
        "Ingest a chunk of text as a Source: extract Facts, resolve Entities, and " +
        "supersede any prior Fact on a single-valued Predicate. Returns the Facts " +
        "created and superseded — each superseded Fact tagged with why it was " +
        "retired: 'cardinality' (same Predicate, new object) or 'contradiction' " +
        "(a cross-Predicate conflict, e.g. 'works-at' retired by 'left').",
      inputSchema: {
        text: z.string().min(1).describe("The text to remember."),
        source: z.string().optional().describe("Optional label for the Source (e.g. a filename)."),
      },
      // Writes to the graph, but Tense NEVER deletes — supersession closes a Fact
      // and retains it (destructiveHint: false). Re-ingesting adds provenance, so
      // it is not idempotent. Operates on the local graph (openWorldHint: false).
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ text, source }) => {
      try {
        return jsonResult(await remember(deps, text, source ?? null));
      } catch (err) {
        return toolError("remember", err);
      }
    },
  );

  server.registerTool(
    "preview",
    {
      title: "Preview",
      description:
        "Dry-run of `remember`: report what ingesting the text WOULD do — Facts it " +
        "would create / supersede / reaffirm, and how each name resolves — WITHOUT " +
        "writing anything. Preview a Source's side effects (and the supersessions it " +
        "triggers) before committing it to memory.",
      inputSchema: {
        text: z.string().min(1).describe("The text to preview ingesting."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ text }) => {
      try {
        return jsonResult(await previewRemember(deps, text));
      } catch (err) {
        return toolError("preview", err);
      }
    },
  );

  server.registerTool(
    "recall",
    {
      title: "Recall",
      description:
        "Return ranked Facts matching the query — Current by default, or whatever " +
        "was Current at `as_of`. Optionally scope to one `predicate` and cap the " +
        "result count with `limit`. Each Fact includes its Source citation, " +
        "validity interval, and `reinforcedBy` (how many Sources assert it).",
      inputSchema: {
        query: z.string().describe("What to recall. Empty returns the temporally-filtered set."),
        as_of: z
          .string()
          .optional()
          .describe("ISO date/time; return Facts that were Current (valid) at that instant."),
        predicate: z
          .string()
          .optional()
          .describe("Restrict to one Predicate, e.g. 'reports-to' ('Reports To' also matches)."),
        limit: z.number().int().positive().optional().describe("Max Facts to return (default 20)."),
        min_reinforced: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Only Facts asserted by at least this many Sources (trust threshold)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, as_of, predicate, limit, min_reinforced }) => {
      const asOf = as_of ? new Date(as_of) : null;
      if (as_of && Number.isNaN(asOf!.getTime())) return errorResult(`invalid as_of date: ${as_of}`);
      const facts = await recall(
        { store: deps.store, provider: deps.provider },
        query,
        { asOf, predicate, limit, minReinforced: min_reinforced },
      );
      return jsonResult(facts);
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
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ entity, predicate }) => {
      return jsonResult(await history({ store: deps.store, resolver: deps.resolver }, entity, predicate));
    },
  );

  server.registerTool(
    "changes",
    {
      title: "Changes",
      description:
        "Return Facts whose transaction time changed since a date — those the memory " +
        "LEARNED (created) or RETIRED (superseded), most-recent change first. The " +
        "change feed for incremental sync ('what changed since I last checked?'); " +
        "distinct from valid-time `recall`. Each carries `learnedAt`/`retiredAt`.",
      inputSchema: {
        since: z.string().describe("ISO date/time; return Facts learned or retired at/after this instant."),
        limit: z.number().int().positive().optional().describe("Max Facts to return (default 50)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ since, limit }) => {
      const sinceDate = new Date(since);
      if (Number.isNaN(sinceDate.getTime())) return errorResult(`invalid since date: ${since}`);
      try {
        return jsonResult(await deps.store.changesSince(sinceDate, limit));
      } catch (err) {
        return toolError("changes", err);
      }
    },
  );

  server.registerTool(
    "stats",
    {
      title: "Stats",
      description:
        "Return a read-only snapshot of the graph: Entity and Source counts, Fact " +
        "totals split Current vs superseded, and a per-Predicate breakdown. Useful " +
        'for an agent to answer "what is in my memory?" without recalling Facts.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        return jsonResult(await deps.store.graphStats());
      } catch (err) {
        return toolError("stats", err);
      }
    },
  );

  server.registerTool(
    "entities",
    {
      title: "Entities",
      description:
        "List the Entities in the graph, each with how many Current Facts touch it " +
        "(subject or object), most-connected first. Optionally filter by a name " +
        "substring. Browse the graph by Entity — complements `recall` (by relevance) " +
        "and `history` (by known subject).",
      inputSchema: {
        query: z.string().optional().describe("Optional name substring to filter Entities (case-insensitive)."),
        limit: z.number().int().positive().optional().describe("Max Entities to return (default 50)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, limit }) => {
      try {
        return jsonResult(await deps.store.listEntities({ query, limit }));
      } catch (err) {
        return toolError("entities", err);
      }
    },
  );

  server.registerTool(
    "sources",
    {
      title: "Sources",
      description:
        "List the ingested Sources, newest first — each with its label, ingest time, " +
        "a text preview, and how many Facts cite it (origin or Reaffirmation). A " +
        "provenance audit of what raw text the memory has seen; full text comes back " +
        "via `recall` (each Fact's `source.text`).",
      inputSchema: {
        limit: z.number().int().positive().optional().describe("Max Sources to return (default 50)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ limit }) => {
      try {
        return jsonResult(await deps.store.listSources({ limit }));
      } catch (err) {
        return toolError("sources", err);
      }
    },
  );

  return server;
}
