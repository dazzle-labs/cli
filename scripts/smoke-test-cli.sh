#!/usr/bin/env bash
set -euo pipefail

# Smoke test: validate that every CLI command referenced in the frontend actually
# exists in the dazzle binary. Runs each subcommand with a short timeout and
# checks for Kong parse errors (unknown command, unexpected argument, etc.).
# Expected runtime errors (auth, network, "stage not found") are fine — they
# prove the command parsed successfully.

DAZZLE="${1:-$(cd cli && go build -o /tmp/dazzle-smoke ./cmd/dazzle && echo /tmp/dazzle-smoke)}"
TIMEOUT=3  # seconds — enough for parse + auth check, kills stdin-blockers
export DAZZLE_STAGE=smoke-test  # so stage-scoped commands don't fail at "no stage selected"

# Extract subcommand paths from the central TS registry.
# Each entry looks like: cmd("stage up", "optional-args")
# We grab the first quoted arg (the subcommand path).
COMMANDS=$(grep -oE 'cmd\("[^"]+"' web/src/lib/cli-commands.ts | sed 's/cmd("//;s/"//' | sort -u)

# Parse errors from Kong that indicate the command itself is invalid.
PARSE_ERROR_PATTERNS="unexpected argument|unknown command|unknown flag"

FAILED=0
TOTAL=0
while IFS= read -r subcmd; do
  TOTAL=$((TOTAL + 1))
  # Run with timeout, capture combined output, provide empty stdin to unblock prompts.
  # shellcheck disable=SC2086
  OUTPUT=$(timeout "${TIMEOUT}" "$DAZZLE" $subcmd 2>&1 </dev/null || true)

  if echo "$OUTPUT" | grep -qiE "$PARSE_ERROR_PATTERNS"; then
    echo "  FAIL dazzle $subcmd"
    echo "    $(echo "$OUTPUT" | head -3)"
    FAILED=$((FAILED + 1))
  else
    echo "  ok   dazzle $subcmd"
  fi
done <<< "$COMMANDS"

echo ""
if [ $FAILED -gt 0 ]; then
  echo "FAIL: $FAILED/$TOTAL command(s) have parse errors"
  exit 1
fi
echo "All $TOTAL CLI commands validated."
