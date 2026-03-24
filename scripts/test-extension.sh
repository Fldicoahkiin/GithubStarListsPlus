#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

bash "$ROOT_DIR/scripts/check-syntax.sh"
bash "$ROOT_DIR/scripts/test-smoke.sh"
python3 "$ROOT_DIR/scripts/build_artifacts.py" >/dev/null
bash "$ROOT_DIR/scripts/test-artifacts.sh"
