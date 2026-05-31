#!/usr/bin/env bash
# claude-permission-popup bootstrap (macOS).
# Checks for Node, then runs the npx installer. Does NOT install Node for you —
# installing a whole runtime for a dialog should be your explicit choice.
set -euo pipefail

if [[ "$(uname)" != "Darwin" ]]; then
  echo "claude-permission-popup is macOS-only (it uses osascript)." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required but was not found." >&2
  echo >&2
  if command -v brew >/dev/null 2>&1; then
    echo "  Install it with:  brew install node" >&2
  else
    echo "  Install it from:  https://nodejs.org" >&2
  fi
  echo >&2
  echo "Then re-run this script." >&2
  exit 1
fi

echo "Node $(node --version) found — installing claude-permission-popup…"
exec npx --yes claude-permission-popup install
