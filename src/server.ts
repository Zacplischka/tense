#!/usr/bin/env node
import "./env.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createPool } from "./db/pool.js";
import { TemporalGraphStore } from "./db/store.js";
import { LlmExtractor } from "./extraction/llm-extractor.js";
import { EntityResolver } from "./resolution/entity-resolver.js";
import { defaultPredicateRegistry } from "./supersession/registry.js";
import { createProvider } from "./provider/openrouter.js";
import { createMcpServer } from "./mcp/server.js";

/**
 * Tense MCP server entry point (stdio transport). The MCP Inspector and MCP
 * clients (Claude Code, Cursor) launch this as `node dist/server.js`.
 *
 * stdout carries the JSON-RPC protocol, so ALL logging must go to stderr.
 */
async function main(): Promise<void> {
  const pool = createPool();
  const provider = createProvider(); // validates OPENROUTER_API_KEY / models

  const deps = {
    store: new TemporalGraphStore(pool),
    extractor: new LlmExtractor(provider),
    resolver: new EntityResolver(pool),
    registry: defaultPredicateRegistry(),
    provider,
  };

  const server = createMcpServer(deps);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[tense] MCP server ready on stdio");

  const shutdown = async () => {
    await pool.end().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[tense] fatal:", err);
  process.exit(1);
});
