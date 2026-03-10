#!/bin/zsh
set -euo pipefail

node --check src/shared/base.js
node --check src/shared/storage.js
node --check src/background.js
node --check src/content.js
node --check src/options.js
node tests/extension-smoke.mjs
