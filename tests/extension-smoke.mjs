import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const rootDir = process.cwd();
const manifestPath = path.join(rootDir, "manifest.json");
const baseScriptPath = path.join(rootDir, "src/shared/base.js");

function loadManifest() {
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function createBrowserLikeGlobal() {
  const timers = new Map();
  let nextTimer = 1;

  return {
    URL,
    Intl,
    Date,
    Promise,
    location: { origin: "https://github.com" },
    document: {
      querySelector() {
        return null;
      }
    },
    setTimeout(fn) {
      const id = nextTimer;
      nextTimer += 1;
      timers.set(id, fn);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    }
  };
}

function loadCore(overrides) {
  const sandbox = createBrowserLikeGlobal();
  Object.assign(sandbox, overrides);
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(baseScriptPath, "utf8"), sandbox, { filename: "base.js" });
  return sandbox.StarListsCore;
}

async function testChromeCallbackApi() {
  const chrome = {
    runtime: {
      lastError: null
    },
    storage: {}
  };

  const core = loadCore({ chrome });
  const target = {
    ping(value, callback) {
      callback(`chrome:${value}`);
    }
  };

  const result = await core.callChrome(target, "ping", ["ok"]);
  assert.equal(result, "chrome:ok");
}

async function testFirefoxPromiseApi() {
  const browser = {
    runtime: {},
    storage: {}
  };

  const core = loadCore({ browser });
  const target = {
    ping(value) {
      return Promise.resolve(`firefox:${value}`);
    }
  };

  const result = await core.callChrome(target, "ping", ["ok"]);
  assert.equal(result, "firefox:ok");
}

function toPlainObject(value) {
  return JSON.parse(JSON.stringify(value));
}

function testParsers() {
  const core = loadCore({ chrome: { runtime: {}, storage: {} } });

  assert.deepEqual(
    toPlainObject(core.parseRepositoryPath("/openai/openai-cookbook")),
    { owner: "openai", repo: "openai-cookbook", key: "openai/openai-cookbook" }
  );

  assert.deepEqual(
    toPlainObject(core.parseListIdentity("https://github.com/stars?list=reading-queue")),
    { id: "reading-queue", url: "https://github.com/stars?list=reading-queue" }
  );

  assert.equal(core.formatStarDate("2025-03-15T08:09:10Z").length > 0, true);
}

function testManifest() {
  const manifest = loadManifest();

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.service_worker, "src/background.js");
  assert.deepEqual(manifest.background.scripts, ["src/background.js"]);
  assert.equal(manifest.browser_specific_settings.gecko.id, "starlistspp@fldicoahkiin.local");
  assert.deepEqual(
    manifest.browser_specific_settings.gecko.data_collection_permissions.required,
    ["none"]
  );
}

await testChromeCallbackApi();
await testFirefoxPromiseApi();
testParsers();
testManifest();
console.log("extension smoke ok");
