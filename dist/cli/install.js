/**
 * Onboarding helpers: turn an installed Tense into a copy-paste MCP config.
 *
 * The friction in connecting Tense to a coding agent was never the protocol —
 * it speaks plain MCP over stdio — but the hand-assembly: find the absolute path
 * to `dist/server.js`, remember the four env vars, and shape them into whatever
 * JSON the client wants. These pure functions do that assembly from the install
 * location itself (`resolveServerPath`) plus the current environment, so
 * `tense init` can emit a ready-to-paste block. No I/O here — `src/server.ts`
 * owns printing; tests cover the rendering.
 */
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
/** Shown in place of a real key when the environment has none yet. */
const KEY_PLACEHOLDER = "sk-or-...";
/** Absolute path to the installed MCP server entry — resolved from this module. */
export function resolveServerPath() {
    // install.ts → dist/cli/install.js (built) or src/cli/install.ts (tests);
    // either way the server entry sits one directory up.
    return fileURLToPath(new URL("../server.js", import.meta.url));
}
/**
 * The four env vars the server reads. Non-secret values come from caller overrides
 * or `loadConfig`; OPENROUTER_API_KEY is deliberately a placeholder unless the
 * caller explicitly supplies one, so `tense init` never prints shell secrets.
 */
export function serverEnv(opts = {}) {
    const cfg = loadConfig();
    return {
        TENSE_DATABASE_URL: opts.databaseUrl ?? cfg.databaseUrl,
        // Never render a secret read from process.env into onboarding output. The
        // generated config is often copied into chats/issues while debugging. Only
        // an explicit test/caller override is rendered; otherwise show a placeholder.
        OPENROUTER_API_KEY: opts.openrouterApiKey ?? KEY_PLACEHOLDER,
        TENSE_EXTRACTION_MODEL: opts.extractionModel ?? cfg.extractionModel,
        TENSE_EMBEDDING_MODEL: opts.embeddingModel ?? cfg.embeddingModel,
    };
}
/** The stdio launch block for one `mcpServers` entry. */
export function mcpServerEntry(opts = {}) {
    return {
        command: "node",
        args: [opts.serverPath ?? resolveServerPath()],
        env: serverEnv(opts),
    };
}
/** The `mcpServers` JSON block (Claude Code / Cursor / Windsurf / any MCP client). */
export function renderMcpJson(opts = {}) {
    return JSON.stringify({ mcpServers: { tense: mcpServerEntry(opts) } }, null, 2);
}
/** Wrap a value in single quotes for a shell, escaping any embedded quote. */
function shellQuote(value) {
    return `'${value.replace(/'/g, "'\\''")}'`;
}
/** A one-line `claude mcp add` that registers Tense with env, for Claude Code. */
export function renderClaudeAddCommand(opts = {}) {
    const path = opts.serverPath ?? resolveServerPath();
    const env = serverEnv(opts);
    const keyValue = opts.openrouterApiKey ? shellQuote(opts.openrouterApiKey) : '"$OPENROUTER_API_KEY"';
    const flags = Object.entries({ ...env, OPENROUTER_API_KEY: keyValue })
        .map(([k, v]) => `-e ${k}=${k === "OPENROUTER_API_KEY" ? v : shellQuote(v)}`)
        .join(" ");
    return `claude mcp add tense ${flags} -- node ${shellQuote(path)}`;
}
/** The full human-facing onboarding message `tense init` prints to stdout. */
export function renderInstall(opts = {}) {
    const lines = [
        "Tense MCP server — connect it to your coding agent",
        "",
        "1) Claude Code (one line):",
        "",
        `   ${renderClaudeAddCommand(opts)}`,
        "",
        "2) Cursor / Windsurf / any MCP client — paste into the mcpServers config:",
        "",
        renderMcpJson(opts)
            .split("\n")
            .map((l) => `   ${l}`)
            .join("\n"),
        "",
        "Before first use: start Postgres/pgvector and run the migrations (see README Quickstart).",
        "Set OPENROUTER_API_KEY in your shell; Tense never prints its value in generated config.",
    ];
    return lines.join("\n");
}
//# sourceMappingURL=install.js.map