from __future__ import annotations

from hashlib import sha256
from pathlib import Path
import json
import shutil
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DIST_DIR = ROOT / "dist"
CHROME_DIR = DIST_DIR / "chrome-unpacked"
FIREFOX_DIR = DIST_DIR / "firefox-unsigned"
USER_SCRIPT = DIST_DIR / "github-star-lists-plus.user.js"
EXTENSION_INCLUDE_PATHS = [
    "manifest.json",
    "src/background.js",
    "src/content.css",
    "src/content.js",
    "src/options.css",
    "src/options.html",
    "src/options.js",
    "src/shared",
]
USERSCRIPT_SOURCES = [
    ROOT / "src/userscript/adapter.js",
    ROOT / "src/shared/base.js",
    ROOT / "src/shared/storage.js",
    ROOT / "src/shared/service.js",
    ROOT / "src/userscript/menu.js",
    ROOT / "src/content.js",
]
REPOSITORY_URL = "https://github.com/Fldicoahkiin/GithubStarListsPlus"


def reset_dir(path: Path) -> None:
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True, exist_ok=True)


def copy_relative(relative_path: str, destination_root: Path) -> None:
    source = ROOT / relative_path
    destination = destination_root / relative_path
    if source.is_dir():
        shutil.copytree(source, destination)
        return

    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)


def zip_directory(source_dir: Path, archive_path: Path) -> None:
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for file_path in sorted(source_dir.rglob("*")):
            if file_path.is_dir():
                continue
            archive.write(file_path, file_path.relative_to(source_dir))


def digest(path: Path) -> str:
    hasher = sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def build_package(target_dir: Path) -> None:
    reset_dir(target_dir)
    for relative_path in EXTENSION_INCLUDE_PATHS:
        copy_relative(relative_path, target_dir)


def build_userscript(user_script_path: Path) -> None:
    manifest = json.loads((ROOT / "manifest.json").read_text())
    css_text = (ROOT / "src/content.css").read_text()
    metadata = [
        "// ==UserScript==",
        f"// @name         {manifest['name']}",
        f"// @namespace    {REPOSITORY_URL}",
        f"// @version      {manifest['version']}",
        f"// @description  {manifest['description']}",
        "// @match        https://github.com/*",
        "// @run-at       document-idle",
        "// @grant        GM_getValue",
        "// @grant        GM_setValue",
        "// @grant        GM_registerMenuCommand",
        "// @grant        GM_xmlhttpRequest",
        "// @grant        GM.getValue",
        "// @grant        GM.setValue",
        "// @grant        GM.registerMenuCommand",
        "// @grant        GM.xmlHttpRequest",
        "// @connect      github.com",
        "// @connect      api.github.com",
        f"// @homepageURL  {REPOSITORY_URL}",
        f"// @supportURL   {REPOSITORY_URL}/issues",
        "// ==/UserScript==",
        "",
    ]
    bootstrap = f"globalThis.__GITHUB_STAR_LISTS_PLUS_USERSTYLE__ = {json.dumps(css_text)};\n"
    chunks = [bootstrap]
    for source in USERSCRIPT_SOURCES:
        chunks.append(source.read_text())
        chunks.append("\n")

    user_script_path.write_text("\n".join(metadata) + "".join(chunks))


def write_install_notes() -> None:
    notes = "\n".join(
        [
            "GitHub StarLists++ CI artifacts",
            "",
            "- chrome-unpacked/: load this folder from chrome://extensions -> Load unpacked",
            "- github-star-lists-plus-chrome-unpacked.zip: packaged copy of the unpacked Chrome folder",
            "- firefox-unsigned/: temporary-install folder for about:debugging in Firefox",
            "- github-star-lists-plus-firefox-unsigned.xpi: unsigned Firefox bundle for temporary loading or future signing",
            "- github-star-lists-plus.user.js: userscript bundle for Tampermonkey or Violentmonkey",
            "",
            "Note: Chrome direct installation requires Chrome Web Store or enterprise distribution.",
            "Note: Firefox permanent installation requires signing.",
            "Note: The userscript path is intended for Tampermonkey or Violentmonkey.",
            "",
        ]
    )
    (DIST_DIR / "install-notes.txt").write_text(notes)


def write_metadata(chrome_zip: Path, firefox_xpi: Path, user_script_path: Path) -> None:
    manifest = json.loads((ROOT / "manifest.json").read_text())
    payload = {
        "name": manifest["name"],
        "version": manifest["version"],
        "repository": REPOSITORY_URL,
        "artifacts": {
            chrome_zip.name: digest(chrome_zip),
            firefox_xpi.name: digest(firefox_xpi),
            user_script_path.name: digest(user_script_path),
        },
    }
    (DIST_DIR / "artifact-metadata.json").write_text(json.dumps(payload, indent=2) + "\n")


def main() -> None:
    reset_dir(DIST_DIR)
    build_package(CHROME_DIR)
    build_package(FIREFOX_DIR)
    build_userscript(USER_SCRIPT)

    chrome_zip = DIST_DIR / "github-star-lists-plus-chrome-unpacked.zip"
    firefox_xpi = DIST_DIR / "github-star-lists-plus-firefox-unsigned.xpi"
    zip_directory(CHROME_DIR, chrome_zip)
    zip_directory(FIREFOX_DIR, firefox_xpi)

    checksums = {
        chrome_zip.name: digest(chrome_zip),
        firefox_xpi.name: digest(firefox_xpi),
        USER_SCRIPT.name: digest(USER_SCRIPT),
    }
    checksums_text = "\n".join(f"{value}  {name}" for name, value in checksums.items()) + "\n"
    (DIST_DIR / "checksums.txt").write_text(checksums_text)

    write_install_notes()
    write_metadata(chrome_zip, firefox_xpi, USER_SCRIPT)

    print("Built artifacts:")
    for item in [
        chrome_zip,
        firefox_xpi,
        USER_SCRIPT,
        DIST_DIR / "checksums.txt",
        DIST_DIR / "install-notes.txt",
        DIST_DIR / "artifact-metadata.json",
    ]:
        print(f"- {item.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
