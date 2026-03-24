# GitHub StarLists++

[![Package](https://github.com/Fldicoahkiin/GithubStarListsPlus/actions/workflows/package.yml/badge.svg)](https://github.com/Fldicoahkiin/GithubStarListsPlus/actions/workflows/package.yml)
[![Chrome-compatible](https://img.shields.io/badge/browser-Chrome%20%2F%20Edge%20%2F%20Brave-2563EB)](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world)
[![Firefox-compatible](https://img.shields.io/badge/browser-Firefox-F97316)](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Temporary_Installation_in_Firefox)
[![Userscript](https://img.shields.io/badge/userscript-Tampermonkey%20%2F%20Violentmonkey-14B8A6)](https://www.tampermonkey.net/)
[![Chinese Docs](https://img.shields.io/badge/docs-Chinese-10B981)](./README.zh-CN.md)

GitHub StarLists++ is a small browser extension and userscript that makes GitHub stars easier to sort, review, and clean up.

It keeps the native GitHub stars and official lists workflow, but adds the missing pieces that make starred repositories usable as an inbox instead of a pile.

The product name is **GitHub StarLists++**. The repository slug remains **GithubStarListsPlus**.

## What It Does

GitHub lets you star repositories quickly, but sorting them into useful lists still feels slow and easy to postpone.

GitHub StarLists++ improves that flow without replacing GitHub itself:

- keep using GitHub stars and official lists
- sort repositories into lists faster
- make ungrouped stars visible and easier to process
- add small workflow helpers directly where starring already happens

## Features

- switch between `All`, `Ungrouped`, and discovered lists on the stars page
- show `Starred on ...` metadata on repository cards
- show list badges on stars cards and repository pages
- search and sort locally on the stars page
- batch add to lists, remove from lists, and unstar
- add a `Lists` action next to the native Star area on repository pages
- optionally open the list panel right after starring a repository

## Install

Choose the form that fits your workflow:

- **Extension**: better if you want a built-in settings page and a more complete long-term setup
- **Userscript**: better if you want the fastest way to try it with Tampermonkey or Violentmonkey

Current pre-release builds are distributed through the `Package` workflow artifacts.

### Chrome / Edge / Brave

1. Open `chrome://extensions`.
2. Enable developer mode.
3. Download the latest artifact from the [`Package` workflow](https://github.com/Fldicoahkiin/GithubStarListsPlus/actions/workflows/package.yml).
4. Unzip `github-star-lists-plus-chrome-unpacked.zip`.
5. Click `Load unpacked` and select the extracted folder.

### Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Download the latest artifact from the [`Package` workflow](https://github.com/Fldicoahkiin/GithubStarListsPlus/actions/workflows/package.yml).
3. Use either the `firefox-unsigned` folder or `github-star-lists-plus-firefox-unsigned.xpi`.
4. Click `Load Temporary Add-on` and select `manifest.json` from the folder, or select the unsigned `.xpi` file.

### Tampermonkey / Violentmonkey

1. Install [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).
2. Download the latest artifact from the [`Package` workflow](https://github.com/Fldicoahkiin/GithubStarListsPlus/actions/workflows/package.yml).
3. Open `github-star-lists-plus.user.js`.
4. Confirm installation in your userscript manager.

## Settings

### Extension

The extension settings page currently lets you:

- show starred date on `https://github.com/stars`
- hide grouped repositories inside `All`
- show list badges on cards and repository pages
- auto-open the list panel right after starring
- save an optional GitHub token for better API quota and `starred_at` coverage

### Userscript

The userscript version uses GM menu commands instead of a separate settings page.

You can use them to:

- toggle the main stars-page and repository-page features
- save or remove a GitHub token
- clear cached data and reload the page

The GitHub token is optional. It is only there to improve API quota and metadata coverage.

## Development

### Quick start

```bash
pnpm run test:all
pnpm run build
```

### Common commands

```bash
pnpm run check:syntax
pnpm run test:smoke
pnpm run test:artifacts
pnpm run test:browser
pnpm run build
```

### Project layout

- `manifest.json` - shared extension manifest
- `src/content.js` - stars page and repository page behavior
- `src/background.js` - extension-side GitHub API bridge
- `src/options.*` - extension settings page
- `src/userscript/*` - userscript adapter and GM menu commands
- `src/shared/*` - shared runtime, storage, and service logic
- `tests/*` - smoke and artifact checks
- `scripts/*` - local test and packaging entry scripts

Build output is written to `dist/`.

## CI Artifacts

This repository currently uses four GitHub Actions workflows:

- [`Lint`](https://github.com/Fldicoahkiin/GithubStarListsPlus/actions/workflows/lint.yml) - syntax checks
- [`Smoke`](https://github.com/Fldicoahkiin/GithubStarListsPlus/actions/workflows/smoke.yml) - runtime smoke test
- [`Package`](https://github.com/Fldicoahkiin/GithubStarListsPlus/actions/workflows/package.yml) - build and upload installable artifacts
- [`Browser`](https://github.com/Fldicoahkiin/GithubStarListsPlus/actions/workflows/browser.yml) - manually triggered Playwright browser test

The `Package` workflow uploads:

- `chrome-unpacked/`
- `github-star-lists-plus-chrome-unpacked.zip`
- `firefox-unsigned/`
- `github-star-lists-plus-firefox-unsigned.xpi`
- `github-star-lists-plus.user.js`
- `checksums.txt`
- `install-notes.txt`
- `artifact-metadata.json`

## FAQ

### Why not build a separate database for lists?

Because the goal is to improve GitHub-native stars and official lists, not replace them with a parallel system.

### Should I use the extension or the userscript?

Use the extension if you want a more complete setup and a built-in settings page. Use the userscript if you want the quickest way to try the workflow changes.

### Can I install the CI artifacts directly?

Yes.

- Chromium browsers use unpacked loading during development.
- Firefox currently uses temporary loading unless the add-on is signed later.
- Tampermonkey and Violentmonkey can install the generated `.user.js` directly.

### Does this send data anywhere else?

No external analytics service or separate backend is involved.

The extension only uses:

- `storage` for local settings and cached data
- `https://github.com/*` for DOM-based enhancements
- `https://api.github.com/*` for GitHub API requests when needed

If you save a GitHub token, it stays in local extension storage or your userscript manager storage and is only used for GitHub API requests.

### Why is Firefox still a temporary install?

Because permanent Firefox distribution needs signing. The current artifact is aimed at local testing and pre-release use.

For Chinese documentation, go to [README.zh-CN.md](./README.zh-CN.md).
