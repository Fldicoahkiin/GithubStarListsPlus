#!/usr/bin/env bash
set -euo pipefail

node --check src/shared/base.js
node --check src/shared/storage.js
node --check src/shared/service.js
node --check src/background.js
node --check src/content.js
node --check src/options.js
node --check src/userscript/adapter.js
node --check src/userscript/menu.js
node tests/extension-smoke.mjs
python3 scripts/build_artifacts.py >/dev/null
node tests/artifact-smoke.mjs
