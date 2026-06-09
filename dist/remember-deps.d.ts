import type pg from "pg";
import type { RememberDeps } from "./pipeline.js";
/**
 * Single source of truth for the `remember` ingest dependencies (ADR 0004).
 *
 * Both ingest entry points build their pipeline through this one factory — the
 * MCP stdio server (`src/server.ts`) and the viewer's `POST /api/remember` route
 * — so the wiring (LLM extractor, fuzzy entity resolver, predicate registry,
 * OpenRouter provider, and the cross-Predicate contradiction path) can never
 * drift between them. `createProvider()` validates OPENROUTER_API_KEY / models.
 */
export declare function createRememberDeps(pool: pg.Pool): RememberDeps;
