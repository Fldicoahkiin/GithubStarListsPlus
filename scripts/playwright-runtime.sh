#!/usr/bin/env bash

clear_playwright_npm_env() {
  local names=(
    npm_config_npm_globalconfig
    npm_config_verify_deps_before_run
    npm_config_global_bin_dir
    npm_config__jsr_registry
    npm_config_enable_pre_post_scripts
    pnpm_config_verify_deps_before_run
  )

  local name
  local upper_name
  for name in "${names[@]}"; do
    upper_name="$(printf '%s' "$name" | tr '[:lower:]' '[:upper:]')"
    unset "$name" 2>/dev/null || true
    unset "$upper_name" 2>/dev/null || true
  done
}

resolve_playwright_node_modules() {
  python3 <<'PY'
from pathlib import Path
import sys

candidates = []
roots = [
    Path.home() / ".npm" / "_npx",
    Path("/opt/homebrew/lib/node_modules"),
]

for root in roots:
    if not root.exists():
        continue
    for package_json in root.glob("**/node_modules/playwright/package.json"):
        try:
            mtime = package_json.stat().st_mtime
        except FileNotFoundError:
            continue
        candidates.append((mtime, str(package_json.parent.parent)))

if not candidates:
    sys.exit(1)

candidates.sort(reverse=True)
print(candidates[0][1])
PY
}

resolve_playwright_chromium_executable() {
  python3 <<'PY'
from pathlib import Path
import sys

roots = [
    Path.home() / "Library" / "Caches" / "ms-playwright",
    Path.home() / ".cache" / "ms-playwright",
]
executables = [
    Path("chrome-mac/Chromium.app/Contents/MacOS/Chromium"),
    Path("chrome-linux/chrome"),
    Path("chrome-win/chrome.exe"),
]
candidates = []

for root in roots:
    if not root.exists():
        continue
    for browser_dir in root.glob("chromium-*"):
        suffix = browser_dir.name.rsplit("-", 1)[-1]
        try:
            revision = int(suffix)
        except ValueError:
            revision = 0

        for relative_path in executables:
            executable = browser_dir / relative_path
            if not executable.exists():
                continue
            candidates.append((revision, executable.stat().st_mtime, str(executable)))
            break

if not candidates:
    sys.exit(1)

candidates.sort(reverse=True)
print(candidates[0][2])
PY
}

resolve_chrome_executable() {
  local candidates=(
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
  )

  local candidate
  for candidate in "${candidates[@]}"; do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  if command -v google-chrome >/dev/null 2>&1; then
    command -v google-chrome
    return 0
  fi

  if command -v chromium >/dev/null 2>&1; then
    command -v chromium
    return 0
  fi

  return 1
}
