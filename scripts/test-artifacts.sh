#!/usr/bin/env bash
set -euo pipefail

export PATH="/opt/homebrew/bin:$PATH"

pnpm exec node tests/artifact-smoke.mjs
