import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const distDir = path.join(rootDir, "dist");

function readText(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), "utf8");
}

function fileExists(relativePath) {
  return fs.existsSync(path.join(rootDir, relativePath));
}

function testArtifactsExist() {
  const requiredFiles = [
    "dist/github-star-lists-plus-chrome-unpacked.zip",
    "dist/github-star-lists-plus-firefox-unsigned.xpi",
    "dist/github-star-lists-plus.user.js",
    "dist/checksums.txt",
    "dist/install-notes.txt",
    "dist/artifact-metadata.json"
  ];

  for (const filePath of requiredFiles) {
    assert.equal(fileExists(filePath), true, `${filePath} should exist`);
  }
}


function testUnpackedTargets() {
  const requiredFolders = [
    "dist/chrome-unpacked",
    "dist/firefox-unsigned"
  ];

  for (const folderPath of requiredFolders) {
    assert.equal(fileExists(folderPath), true, `${folderPath} should exist`);
  }

  assert.equal(fileExists("dist/chrome-unpacked/src/userscript"), false);
  assert.equal(fileExists("dist/firefox-unsigned/src/userscript"), false);
}

function testUserscriptMetadata() {
  const source = readText("dist/github-star-lists-plus.user.js");
  assert.equal(source.includes("// ==UserScript=="), true);
  assert.equal(source.includes("@match        https://github.com/*"), true);
  assert.equal(source.includes("@grant        GM_registerMenuCommand"), true);
  assert.equal(source.includes("globalThis.__GITHUB_STAR_LISTS_PLUS_USERSTYLE__"), true);
  assert.equal(source.includes("GithubStarListsPlusPlatform"), true);
}

function testArtifactMetadata() {
  const metadata = JSON.parse(readText("dist/artifact-metadata.json"));
  assert.equal(typeof metadata.version, "string");
  assert.equal(metadata.repository, "https://github.com/Fldicoahkiin/GithubStarListsPlus");
  assert.equal(typeof metadata.artifacts["github-star-lists-plus.user.js"], "string");
}

function testChecksums() {
  const checksums = readText("dist/checksums.txt");
  assert.equal(checksums.includes("github-star-lists-plus.user.js"), true);
  assert.equal(checksums.includes("github-star-lists-plus-chrome-unpacked.zip"), true);
  assert.equal(checksums.includes("github-star-lists-plus-firefox-unsigned.xpi"), true);
}

assert.equal(fs.existsSync(distDir), true, "dist directory should exist");
testArtifactsExist();
testUnpackedTargets();
testUserscriptMetadata();
testArtifactMetadata();
testChecksums();
console.log("artifact smoke ok");
