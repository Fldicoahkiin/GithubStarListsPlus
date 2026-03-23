#!/usr/bin/env bash
set -euo pipefail

export PATH="/opt/homebrew/bin:$PATH"

pnpm exec node --check src/shared/base.js
pnpm exec node --check src/shared/storage.js
pnpm exec node --check src/shared/service.js
pnpm exec node --check src/background.js
pnpm exec node --check src/content.js
pnpm exec node --check src/options.js
pnpm exec node --check src/userscript/adapter.js
pnpm exec node --check src/userscript/menu.js
pnpm exec node tests/extension-smoke.mjs
pnpm exec python3 scripts/build_artifacts.py >/dev/null
pnpm exec node tests/artifact-smoke.mjs
