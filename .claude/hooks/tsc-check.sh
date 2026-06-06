#!/usr/bin/env bash
# PostToolUse hook: type-check the project after a TypeScript edit.
#
# Reads the hook payload on stdin, runs `tsc --noEmit`, and on failure exits 2
# so the compiler output is fed back into Claude's context as actionable errors.
# A clean check exits 0 silently.

set -uo pipefail

input=$(cat)

# Path of the file the tool just touched.
file=$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_response.filePath // empty')

# Only type-check TypeScript sources; ignore .d.ts, json, md, etc.
case "$file" in
  *.d.ts) exit 0 ;;
  *.ts | *.tsx | *.mts | *.cts) ;;
  *) exit 0 ;;
esac

# Locate the project root that owns a tsconfig.json:
#   1. CLAUDE_PROJECT_DIR (set by Claude Code when the hook runs)
#   2. walk up from the edited file's directory
#   3. fall back to the current working directory
root="${CLAUDE_PROJECT_DIR:-}"
if [ -z "$root" ] || [ ! -f "$root/tsconfig.json" ]; then
  dir=$(CDPATH= cd -- "$(dirname -- "$file")" 2>/dev/null && pwd)
  while [ -n "$dir" ] && [ "$dir" != "/" ]; do
    if [ -f "$dir/tsconfig.json" ]; then
      root="$dir"
      break
    fi
    dir=$(dirname -- "$dir")
  done
fi
root="${root:-$PWD}"

cd "$root" 2>/dev/null || exit 0
[ -f tsconfig.json ] || exit 0

# Prefer the project's own compiler; fall back to pnpm exec.
if [ -x node_modules/.bin/tsc ]; then
  out=$(node_modules/.bin/tsc -p tsconfig.json --noEmit 2>&1)
else
  out=$(pnpm exec tsc -p tsconfig.json --noEmit 2>&1)
fi
status=$?

if [ "$status" -ne 0 ]; then
  {
    echo "tsc --noEmit reported type errors (project root: $root) after editing ${file#"$root"/}:"
    echo
    echo "$out"
    echo
    echo "Fix these type errors before continuing."
  } >&2
  exit 2
fi

exit 0
