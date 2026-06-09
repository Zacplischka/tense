import { describe, expect, it } from "vitest";
import {
  mcpServerEntry,
  renderMcpJson,
  renderClaudeAddCommand,
  resolveServerPath,
  serverEnv,
} from "../src/cli/install.js";

describe("CLI install config", () => {
  const serverPath = "/opt/tense/dist/server.js";

  describe("resolveServerPath", () => {
    it("resolves the installed MCP server entry (…/server.js)", () => {
      const p = resolveServerPath();
      expect(p).toMatch(/server\.js$/);
      expect(p.startsWith("/")).toBe(true); // absolute, ready to paste
    });
  });

  describe("serverEnv", () => {
    it("fills the four env keys, defaulting DB and models", () => {
      const env = serverEnv({ openrouterApiKey: "sk-or-real" });
      expect(env.TENSE_DATABASE_URL).toMatch(/^postgres:\/\//);
      expect(env.TENSE_EXTRACTION_MODEL).toBeTruthy();
      expect(env.TENSE_EMBEDDING_MODEL).toBeTruthy();
      expect(env.OPENROUTER_API_KEY).toBe("sk-or-real");
    });

    it("uses a clear placeholder when no key is available", () => {
      const env = serverEnv({ openrouterApiKey: undefined });
      expect(env.OPENROUTER_API_KEY).toBe("sk-or-...");
    });

    it("lets the caller override the database url", () => {
      const env = serverEnv({ databaseUrl: "postgres://db/x" });
      expect(env.TENSE_DATABASE_URL).toBe("postgres://db/x");
    });
  });

  describe("mcpServerEntry", () => {
    it("is a node + absolute-path stdio launch with env", () => {
      const entry = mcpServerEntry({ serverPath });
      expect(entry.command).toBe("node");
      expect(entry.args).toEqual([serverPath]);
      expect(Object.keys(entry.env)).toEqual([
        "TENSE_DATABASE_URL",
        "OPENROUTER_API_KEY",
        "TENSE_EXTRACTION_MODEL",
        "TENSE_EMBEDDING_MODEL",
      ]);
    });
  });

  describe("renderMcpJson", () => {
    it("is valid JSON shaped for an mcpServers block", () => {
      const json = renderMcpJson({ serverPath });
      const parsed = JSON.parse(json);
      expect(parsed.mcpServers.tense.command).toBe("node");
      expect(parsed.mcpServers.tense.args).toEqual([serverPath]);
      expect(parsed.mcpServers.tense.env.TENSE_DATABASE_URL).toMatch(/^postgres:\/\//);
    });
  });

  describe("renderClaudeAddCommand", () => {
    it("is a single `claude mcp add` line carrying env and the launch", () => {
      const cmd = renderClaudeAddCommand({ serverPath });
      expect(cmd.startsWith("claude mcp add tense ")).toBe(true);
      expect(cmd).toContain('-e OPENROUTER_API_KEY="$OPENROUTER_API_KEY"');
      expect(cmd).toContain("-e TENSE_DATABASE_URL=");
      expect(cmd).toContain(`-- node '${serverPath}'`);
      expect(cmd).not.toContain("\n"); // one line, copy-pasteable
    });

    it("does not print a process OPENROUTER_API_KEY secret into generated install output", () => {
      const previous = process.env.OPENROUTER_API_KEY;
      process.env.OPENROUTER_API_KEY = "sk-or-do-not-print";
      try {
        expect(renderClaudeAddCommand({ serverPath })).not.toContain("sk-or-do-not-print");
        expect(renderMcpJson({ serverPath })).not.toContain("sk-or-do-not-print");
      } finally {
        if (previous === undefined) delete process.env.OPENROUTER_API_KEY;
        else process.env.OPENROUTER_API_KEY = previous;
      }
    });
  });
});
