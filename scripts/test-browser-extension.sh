#!/usr/bin/env bash
set -euo pipefail

export PATH="/opt/homebrew/bin:$PATH"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$ROOT_DIR/scripts/playwright-runtime.sh"

clear_playwright_npm_env
python3 "$ROOT_DIR/scripts/build_artifacts.py" >/dev/null

PLAYWRIGHT_NODE_MODULES="$(resolve_playwright_node_modules)"

if [[ -z "${PLAYWRIGHT_NODE_MODULES:-}" ]]; then
  echo "Unable to resolve a local Playwright runtime." >&2
  exit 1
fi

export NODE_PATH="$PLAYWRIGHT_NODE_MODULES${NODE_PATH:+:$NODE_PATH}"

PLAYWRIGHT_BROWSER_EXECUTABLE="${PLAYWRIGHT_BROWSER_EXECUTABLE:-${CHROME_EXECUTABLE:-$(resolve_playwright_chromium_executable || true)}}"

if [[ -z "${PLAYWRIGHT_BROWSER_EXECUTABLE:-}" ]]; then
  echo "Unable to resolve a local Playwright Chromium executable." >&2
  echo "Install it with: PATH=/opt/homebrew/bin:\$PATH pnpm dlx playwright install chromium" >&2
  exit 1
fi

mkdir -p "$ROOT_DIR/output/playwright"

export ROOT_DIR
export PLAYWRIGHT_BROWSER_EXECUTABLE
export EXTENSION_DIR="$ROOT_DIR/dist/chrome-unpacked"
export PLAYWRIGHT_OUTPUT_DIR="$ROOT_DIR/output/playwright"

node "$ROOT_DIR/tests/github-extension-browser.playwright.cjs"
