#!/bin/bash
# SessionStart hook: ensure the project is set up in Claude Code on the web /
# remote sessions. Critically, `pnpm install` runs husky's `prepare` script,
# which sets local `core.hooksPath` so the aggressive pre-push hook
# (.husky/pre-push: typecheck + lint + test + build) actually fires before any
# push. Without
# this, a fresh remote container would push WITHOUT running the hook, because
# core.hooksPath is local git config that isn't part of the clone.
set -euo pipefail

# Only run in the remote/web environment; local devs get hooks wired via their
# own `pnpm install`.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Install deps (idempotent). This triggers `prepare` -> husky, wiring hooks.
pnpm install

# Belt-and-suspenders: make sure hooks are active even if `prepare` was skipped.
pnpm exec husky 2>/dev/null || true

echo "Session setup complete: deps installed, pre-push hook wired."
