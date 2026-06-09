#!/usr/bin/env node
import "./env.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createPool } from "./db/pool.js";
import { createRememberDeps } from "./remember-deps.js";
import { createMcpServer } from "./mcp/server.js";
import { renderInstall } from "./cli/install.js";
/**
 * Tense MCP server entry point (stdio transport). The MCP Inspector and MCP
 * clients (Claude Code, Cursor) launch this as `node dist/server.js` with NO
 * args — that path starts the server. A leading `init`/`config` arg instead
 * prints a ready-to-paste MCP config and exits, so onboarding is one command
 * (`tense init`) rather than hand-assembling JSON with an absolute path.
 *
 * stdout carries the JSON-RPC protocol, so ALL logging must go to stderr.
 */
async function main() {
    const pool = createPool();
    const deps = createRememberDeps(pool); // validates OPENROUTER_API_KEY / models
    const server = createMcpServer(deps);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[tense] MCP server ready on stdio");
    const shutdown = async () => {
        await pool.end().catch(() => { });
        process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}
/** Print the onboarding config (`tense init`) and the usage banner. */
function printInstall() {
    // Onboarding output is the command's product, so it goes to stdout (unlike
    // server logs, which must stay on stderr to keep stdout clean for JSON-RPC).
    console.log(renderInstall());
}
const command = process.argv[2];
switch (command) {
    case "init":
    case "config":
        printInstall();
        break;
    case "-h":
    case "--help":
        console.log("Usage: tense [command]\n\n" +
            "  (no command)   Start the MCP server on stdio (how MCP clients launch it)\n" +
            "  init, config   Print a ready-to-paste MCP config for your coding agent\n" +
            "  -h, --help     Show this help");
        break;
    default:
        main().catch((err) => {
            console.error("[tense] fatal:", err);
            process.exit(1);
        });
}
//# sourceMappingURL=server.js.map