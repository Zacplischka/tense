export interface InstallOptions {
    /** Absolute path to the server entry; defaults to the installed `dist/server.js`. */
    serverPath?: string;
    databaseUrl?: string;
    openrouterApiKey?: string;
    extractionModel?: string;
    embeddingModel?: string;
}
/** Absolute path to the installed MCP server entry — resolved from this module. */
export declare function resolveServerPath(): string;
/**
 * The four env vars the server reads. Non-secret values come from caller overrides
 * or `loadConfig`; OPENROUTER_API_KEY is deliberately a placeholder unless the
 * caller explicitly supplies one, so `tense init` never prints shell secrets.
 */
export declare function serverEnv(opts?: InstallOptions): Record<string, string>;
/** The stdio launch block for one `mcpServers` entry. */
export declare function mcpServerEntry(opts?: InstallOptions): {
    command: string;
    args: string[];
    env: Record<string, string>;
};
/** The `mcpServers` JSON block (Claude Code / Cursor / Windsurf / any MCP client). */
export declare function renderMcpJson(opts?: InstallOptions): string;
/** A one-line `claude mcp add` that registers Tense with env, for Claude Code. */
export declare function renderClaudeAddCommand(opts?: InstallOptions): string;
/** The full human-facing onboarding message `tense init` prints to stdout. */
export declare function renderInstall(opts?: InstallOptions): string;
