#!/bin/bash
# Block npm and yarn commands — use pnpm instead.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command')

# Only block when npm/yarn is used as the command itself, not in filenames
if echo "$COMMAND" | grep -qE '(^|[;&|] *)(npm|npx) '; then
  echo "Blocked: npm is not allowed in this project. Use pnpm instead." >&2
  exit 2
fi

if echo "$COMMAND" | grep -qE '(^|[;&|] *)(yarn) '; then
  echo "Blocked: yarn is not allowed in this project. Use pnpm instead." >&2
  exit 2
fi

exit 0
