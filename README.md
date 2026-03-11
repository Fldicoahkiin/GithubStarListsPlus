# GithubStarListsPlus

[![CI](https://github.com/Fldicoahkiin/GithubStarListsPlus/actions/workflows/ci.yml/badge.svg)](https://github.com/Fldicoahkiin/GithubStarListsPlus/actions/workflows/ci.yml)
[![Chrome-compatible](https://img.shields.io/badge/browser-Chrome%20%2F%20Edge%20%2F%20Brave-2563EB)](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world)
[![Firefox-compatible](https://img.shields.io/badge/browser-Firefox-F97316)](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Temporary_Installation_in_Firefox)
[![Userscript](https://img.shields.io/badge/userscript-Tampermonkey%20%2F%20Violentmonkey-14B8A6)](https://www.tampermonkey.net/)
[![Chinese Docs](https://img.shields.io/badge/docs-Chinese-10B981)](./README.zh-CN.md)

GithubStarListsPlus turns GitHub starred lists into an actual inbox-and-triage workflow instead of a passive archive.

The product name and repository slug are both **GithubStarListsPlus**.

For Chinese documentation, go to [README.zh-CN.md](./README.zh-CN.md).

## Preview

### Stars page: ungrouped triage view

![GithubStarListsPlus stars page preview](docs/images/stars-page-preview.svg)

### Repository page: quick list assignment next to Star

![GithubStarListsPlus repository panel preview](docs/images/repository-panel-preview.svg)

## Contents

- [Why GithubStarListsPlus](#why-githubstarlistsplus)
- [Highlights](#highlights)
- [Supported runtimes](#supported-runtimes)
- [Configuration](#configuration)
- [Compatibility matrix](#compatibility-matrix)
- [Install](#install)
- [CI artifacts](#ci-artifacts)
- [Permissions and privacy](#permissions-and-privacy)
- [Project structure](#project-structure)
- [Development](#development)
- [Roadmap](#roadmap)
- [FAQ](#faq)
- [Chinese docs](#chinese-docs)

## Why GithubStarListsPlus

GitHub already ships starred repositories and official lists, but the default flow still leaves one painful gap: you can star a repository quickly, yet organizing it into a useful list still feels delayed and easy to ignore.

GithubStarListsPlus keeps the native GitHub model and improves the workflow around it:

- no parallel database
- no custom list system outside GitHub
- immediate list assignment after starring
- an opinionated `Ungrouped` workflow that helps you keep stars clean

## Highlights

### Stars page

- `All`, `Ungrouped`, and discovered list switching
- optional hiding of grouped repositories inside `All`
- `Starred on ...` metadata directly on repo cards
- list badges on repo cards
- local search across repository names, descriptions, and list names
- local sorting by starred date
- batch selection with bulk unstar

### Repository page

- a `Lists` action next to the native Star area
- cached list badges near the Star button
- searchable multi-select list panel
- optional auto-open after starring a repository

### Philosophy

- stay as close as possible to GitHub-native behavior
- make ungrouped stars obvious, instead of invisible debt
- optimize for fast classification right where the star action happens

## Supported runtimes

### Extension targets

- Chrome
- Edge / Brave via Chrome-compatible extension loading
- Firefox

### Userscript targets

- Tampermonkey
- Violentmonkey
- other GM-compatible managers may work, but are not the primary target yet

The codebase includes a lightweight compatibility layer for callback-style `chrome.*` APIs, Promise-style `browser.*` APIs, and GM-style userscript APIs.

## Configuration

### Extension settings page

The options page currently covers the workflow-critical toggles:

- show starred date on `https://github.com/stars`
- hide grouped repositories inside `All`
- show list badges on cards and repository pages
- auto-open the list panel right after starring
- optional GitHub token for better API quota and `starred_at` coverage

### Userscript settings flow

Userscripts do not have a separate options page yet. Instead, GithubStarListsPlus exposes GM menu commands for:

- toggling the main stars-page and repository-page behaviors
- saving or clearing a GitHub token
- resetting cached metadata and forcing a reload

## Compatibility matrix

| Runtime | Install path | Current status | Notes |
| --- | --- | --- | --- |
| Chrome / Edge / Brave | MV3 extension | Supported | Load unpacked from CI artifact during pre-release |
| Firefox | MV3 extension with `gecko` metadata | Supported | Temporary install today, signing later |
| Tampermonkey | userscript | Supported | Good low-friction path for DOM-first usage |
| Violentmonkey | userscript | Supported | Same generated `.user.js` bundle |


## Install

### Chrome / Edge / Brave

Current pre-release installation path:

1. Open `chrome://extensions`.
2. Enable developer mode.
3. Download the latest CI artifact from [Actions](https://github.com/Fldicoahkiin/GithubStarListsPlus/actions/workflows/ci.yml).
4. Unzip `github-star-lists-plus-chrome-unpacked.zip`.
5. Click `Load unpacked` and select the extracted folder.

### Firefox

Current pre-release installation path:

1. Open `about:debugging#/runtime/this-firefox`.
2. Download the latest CI artifact from [Actions](https://github.com/Fldicoahkiin/GithubStarListsPlus/actions/workflows/ci.yml).
3. Use either the `firefox-unsigned` folder or `github-star-lists-plus-firefox-unsigned.xpi`.
4. Choose `Load Temporary Add-on` and select `manifest.json` from the folder, or the unsigned `.xpi` file.

### Tampermonkey / Violentmonkey

Current pre-release installation path:

1. Install [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).
2. Download the latest CI artifact from [Actions](https://github.com/Fldicoahkiin/GithubStarListsPlus/actions/workflows/ci.yml).
3. Open `github-star-lists-plus.user.js` from the artifact.
4. Confirm installation in your userscript manager.

## CI artifacts

GitHub Actions currently generates installation bundles on every push, pull request, and manual run.

Workflow: [`CI`](https://github.com/Fldicoahkiin/GithubStarListsPlus/actions/workflows/ci.yml)

Each successful run uploads:

- `chrome-unpacked/` - unpacked folder for Chromium developer-mode loading
- `github-star-lists-plus-chrome-unpacked.zip` - zipped copy of the unpacked Chromium bundle
- `firefox-unsigned/` - unpacked folder for Firefox temporary loading
- `github-star-lists-plus-firefox-unsigned.xpi` - unsigned Firefox bundle for temporary install or future signing
- `github-star-lists-plus.user.js` - userscript bundle for Tampermonkey or Violentmonkey
- `checksums.txt` - SHA-256 digests for the packaged archives
- `install-notes.txt` - quick installation notes included inside the artifact
- `artifact-metadata.json` - extension name, version, and archive digests

Release publishing is intentionally not wired yet. Once the extension is more stable, packaging can move from CI runs to tagged releases.

## Permissions and privacy

GithubStarListsPlus keeps the data model intentionally small:

- `storage`: save local settings, cached list catalog data, and cached `starred_at` metadata
- `https://github.com/*`: read the current page DOM and reuse GitHub-native list flows
- `https://api.github.com/*`: fetch `starred_at` metadata and perform authenticated unstar requests when you ask for them

No external analytics, no remote tracking service, and no separate GithubStarListsPlus backend are involved. If you provide a GitHub token, it is stored locally by the extension or userscript manager and only used for GitHub API requests.

## Project structure

- `manifest.json` - extension manifest shared across Chrome and Firefox
- `src/userscript/*` - userscript adapter and GM menu commands
- `src/background.js` - extension-side GitHub API bridge for Chrome and Firefox
- `src/content.js` - stars page and repository page enhancements
- `src/options.*` - extension settings page
- `src/shared/*` - shared runtime, storage, and service logic across targets
- `docs/images/*` - README preview assets
- `tests/extension-smoke.mjs` - runtime compatibility and manifest smoke test
- `tests/artifact-smoke.mjs` - artifact shape and userscript bundle smoke test
- `scripts/test-extension.sh` - local smoke test entry
- `scripts/build_artifacts.py` - CI packaging script for extension and userscript bundles

## Development

### Run the local smoke test

```bash
bash ./scripts/test-extension.sh
```

The smoke test covers:

- syntax validation for extension scripts
- Chrome callback API compatibility
- Firefox Promise API compatibility
- manifest checks for both browsers
- artifact packaging generation
- userscript bundle generation

### Build bundles locally

```bash
python3 ./scripts/build_artifacts.py
```

The generated files are written to `dist/`.

## Roadmap

- batch add/remove lists from the stars page toolbar
- harden repository-page list parsing against GitHub DOM changes
- add a popup or command surface for quick settings and cache controls
- move install bundles from CI artifacts to tagged releases when the extension is ready
- keep the userscript target aligned with the extension feature set where practical

## FAQ

### Why not create a separate list database?

Because the product goal is to enhance GitHub-native stars and official lists, not replace them.

### Can the CI artifacts be installed directly?

Yes, with different expectations by runtime.

- Chromium browsers still expect unpacked loading during development unless the extension is distributed through the Chrome Web Store or enterprise distribution.
- Firefox permanent installation requires a signed add-on, but the unsigned `.xpi` works for temporary developer loading.
- Tampermonkey and Violentmonkey can install the generated `.user.js` directly from the CI artifact.

### Why is there a Firefox-specific `gecko.id` in the manifest?

Because Firefox uses `browser_specific_settings.gecko` for browser-specific metadata and extension ID handling.

### Is release automation included already?

Not yet. The current workflow intentionally uploads artifacts on normal CI runs only.

### Why support a userscript build as well?

Because userscript managers are a very low-friction way to try DOM enhancements quickly, while browser extensions remain the main long-term distribution target.

### Why are both `background.service_worker` and `background.scripts` present?

Because the project targets Chrome-style MV3 service workers and Firefox's current MV3 background-script behavior at the same time, so the manifest keeps a dual-target background definition for one shared source tree.

## Chinese docs

If you prefer reading the project in Chinese, go to [README.zh-CN.md](./README.zh-CN.md).
