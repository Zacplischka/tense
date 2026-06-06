import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * ESLint flat config for the Tense server code (src/test/eval/scripts). Static
 * analysis on top of the strict `tsc` gate — it catches the drift the compiler
 * doesn't (unused vars, unsafe patterns) without duplicating type checking.
 *
 * Non-type-checked typescript-eslint (fast, no program build). Two deliberate
 * project choices: empty `catch {}` is allowed (the codebase uses it for genuine
 * best-effort paths — embeddings, env load, contradiction judge), and
 * `no-explicit-any` is off (intentional at the pg/HTTP boundary and in test
 * helpers). The viewer is a separate package with its own toolchain.
 */
export default [
  { ignores: ["dist/", "viewer/", "dspy/", "coverage/", "node_modules/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "no-empty": ["error", { allowEmptyCatch: true }],
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
