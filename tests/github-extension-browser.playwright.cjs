const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BROWSER_EXECUTABLE = process.env.PLAYWRIGHT_BROWSER_EXECUTABLE || "";
const EXTENSION_DIR = process.env.EXTENSION_DIR;
const OUTPUT_DIR = process.env.PLAYWRIGHT_OUTPUT_DIR;

if (!EXTENSION_DIR || !OUTPUT_DIR) {
  throw new Error("Missing browser regression environment.");
}

const STARS_URL = "https://github.com/Fldicoahkiin?tab=stars";
const REPO_URL = "https://github.com/paperclipai/paperclip";
const SETTINGS_KEY = "githubStarListsPlusSettings";
const REPO_CACHE_KEY = "githubStarListsPlusRepoCache";
const LIST_CATALOG_KEY = "githubStarListsPlusListCatalog";
const LIST_ITEMS = Object.freeze([
  {
    id: "llm",
    name: "LLM",
    url: "https://github.com/stars/Fldicoahkiin/lists/llm"
  }
]);
const SEEDED_REPOSITORIES = Object.freeze({
  "fldicoahkiin/githubstarlistsplus": Object.freeze({
    starredAt: "2026-01-16T09:59:00Z",
    expectedDateText: "2026/01/16 17:59",
    lists: Object.freeze([])
  }),
  "paperclipai/paperclip": Object.freeze({
    starredAt: "2026-01-15T08:30:00Z",
    expectedDateText: "2026/01/15 16:30",
    lists: LIST_ITEMS
  })
});

function mkdirp(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function createProfileDir() {
  const profileDir = path.join(OUTPUT_DIR, `chrome-profile-${Date.now()}`);
  mkdirp(profileDir);
  return profileDir;
}

async function waitForExtensionWorker(context) {
  const existing = context.serviceWorkers().find((worker) => worker.url().startsWith("chrome-extension://"));
  if (existing) {
    return existing;
  }

  return context.waitForEvent("serviceworker", {
    timeout: 20000,
    predicate: (worker) => worker.url().startsWith("chrome-extension://")
  });
}

async function seedExtensionStorage(worker) {
  const now = Date.now();
  const settings = {
    showStarDate: true,
    hideGroupedInAll: true,
    showListBadges: true,
    adaptToTheme: true,
    autoOpenAfterStar: true,
    enableBatchSelection: true,
    token: ""
  };
  const repoCache = Object.fromEntries(
    Object.entries(SEEDED_REPOSITORIES).map(([repoKey, repo]) => [
      repoKey,
      {
        starredAt: repo.starredAt,
        starCheckedAt: now,
        lists: [...repo.lists],
        listCheckedAt: now
      }
    ])
  );
  const listCatalog = {
    items: [...LIST_ITEMS],
    updatedAt: now
  };

  return worker.evaluate(
    async ({ settings, repoCache, listCatalog, settingsKey, repoCacheKey, listCatalogKey }) => {
      const storageSet = (area, value) => new Promise((resolve, reject) => {
        chrome.storage[area].set(value, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve();
        });
      });

      const storageGet = (area, key) => new Promise((resolve, reject) => {
        chrome.storage[area].get(key, (value) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(value);
        });
      });

      await storageSet("sync", {
        [settingsKey]: settings
      });
      await storageSet("local", {
        [repoCacheKey]: repoCache,
        [listCatalogKey]: listCatalog
      });

      return {
        sync: await storageGet("sync", settingsKey),
        local: await storageGet("local", [repoCacheKey, listCatalogKey])
      };
    },
    {
      settings,
      repoCache,
      listCatalog,
      settingsKey: SETTINGS_KEY,
      repoCacheKey: REPO_CACHE_KEY,
      listCatalogKey: LIST_CATALOG_KEY
    }
  );
}

async function verifyStarsPage(page) {
  await page.goto(STARS_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(
    () => document.querySelectorAll("main h3 a[href], main h2 a[href]").length >= 2,
    null,
    { timeout: 30000 }
  );
  await page.waitForFunction(
    () => Boolean(document.querySelector("[data-github-star-lists-plus-view-kind='filter']")),
    null,
    { timeout: 30000 }
  );

  const initialState = await page.evaluate(() => {
    const anchors = [...document.querySelectorAll("main h3 a[href], main h2 a[href]")];
    const repoKeys = anchors.map((anchor) => {
      const parts = new URL(anchor.href, location.origin).pathname.split("/").filter(Boolean);
      return parts.length === 2 ? `${parts[0].toLowerCase()}/${parts[1].toLowerCase()}` : "";
    }).filter(Boolean);

    const seed = ["fldicoahkiin/githubstarlistsplus", "paperclipai/paperclip"];
    const seededDateTexts = Object.fromEntries(seed.map((repoKey) => {
      const anchor = anchors.find((item) => {
        const parts = new URL(item.href, location.origin).pathname.split("/").filter(Boolean);
        return parts.length === 2 && `${parts[0].toLowerCase()}/${parts[1].toLowerCase()}` === repoKey;
      });
      const card = anchor?.closest("li, article, .Box-row, .col-12");
      return [repoKey, {
        dateText: card?.querySelector(".github-star-lists-plus-native-date")?.textContent?.trim() || "",
        labelText: card?.querySelector(".github-star-lists-plus-ungrouped-label")?.textContent?.trim() || ""
      }];
    }));

    return {
      repoKeys: repoKeys.slice(0, 8),
      seededDateTexts
    };
  });

  assert.equal(
    initialState.seededDateTexts["fldicoahkiin/githubstarlistsplus"]?.dateText,
    SEEDED_REPOSITORIES["fldicoahkiin/githubstarlistsplus"].expectedDateText
  );
  assert.equal(initialState.seededDateTexts["fldicoahkiin/githubstarlistsplus"]?.labelText, "Ungrouped");
  assert.equal(
    initialState.seededDateTexts["paperclipai/paperclip"]?.dateText,
    SEEDED_REPOSITORIES["paperclipai/paperclip"].expectedDateText
  );

  await page.evaluate(() => {
    const trigger = [...document.querySelectorAll("button")]
      .find((button) => /sort by/i.test(button.textContent || ""));
    if (!trigger) {
      throw new Error("Sort trigger not found.");
    }
    trigger.click();
  });

  await page.waitForSelector("[data-github-star-lists-plus-menu-option='star-asc']", { timeout: 10000 });
  await page.click("[data-github-star-lists-plus-menu-option='star-asc']");
  await page.waitForFunction(
    () => new URL(location.href).searchParams.get("slp-sort") === "star-asc",
    null,
    { timeout: 10000 }
  );

  await page.click("[data-github-star-lists-plus-view-kind='filter']");
  await page.waitForFunction(
    () => new URL(location.href).searchParams.get("slp-filter") === "ungrouped",
    null,
    { timeout: 10000 }
  );

  const finalState = await page.evaluate(() => {
    function readCardState(repoKey) {
      const anchor = [...document.querySelectorAll("main h3 a[href], main h2 a[href]")]
        .find((item) => {
          const parts = new URL(item.href, location.origin).pathname.split("/").filter(Boolean);
          return parts.length === 2 && `${parts[0].toLowerCase()}/${parts[1].toLowerCase()}` === repoKey;
        });
      const card = anchor?.closest("li, article, .Box-row, .col-12");
      return {
        hidden: card?.classList.contains("github-star-lists-plus-hidden") || false,
        dateText: card?.querySelector(".github-star-lists-plus-native-date")?.textContent?.trim() || "",
        labelText: card?.querySelector(".github-star-lists-plus-ungrouped-label")?.textContent?.trim() || ""
      };
    }

    return {
      filterPressed: document.querySelector("[data-github-star-lists-plus-view-kind='filter']")?.getAttribute("aria-pressed") || "false",
      sortOptions: [...document.querySelectorAll("[data-github-star-lists-plus-menu-kind='sort']")].map((item) => item.textContent.trim()),
      paginationLinks: [...document.querySelectorAll("nav[aria-label='Pagination'] a, .paginate-container a")].map((anchor) => anchor.href),
      ungroupedRepo: readCardState("fldicoahkiin/githubstarlistsplus"),
      groupedRepo: readCardState("paperclipai/paperclip"),
      locationSearch: location.search
    };
  });

  assert.equal(finalState.filterPressed, "true");
  assert.equal(finalState.ungroupedRepo.labelText, "Ungrouped");
  assert.equal(finalState.groupedRepo.hidden, true);
  assert.equal(finalState.locationSearch.includes("slp-sort=star-asc"), true);
  assert.equal(finalState.locationSearch.includes("slp-filter=ungrouped"), true);
  assert.equal(finalState.sortOptions.includes("Star newest"), true);
  assert.equal(finalState.sortOptions.includes("Star oldest"), true);
  assert.equal(finalState.paginationLinks.length > 0, true);
  assert.equal(finalState.paginationLinks.every((href) => href.includes("slp-sort=star-asc") && href.includes("slp-filter=ungrouped")), true);

  const screenshotPath = path.join(OUTPUT_DIR, "extension-stars.png");
  await page.screenshot({ path: screenshotPath, fullPage: true, timeout: 30000 });

  return {
    ...finalState,
    screenshotPath
  };
}

async function verifyRepositoryPage(page) {
  await page.goto(REPO_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(
    () => Boolean(
      document.querySelector("a[aria-label*='star a repository' i]")
      || document.querySelector("a[aria-label*='unstar this repository' i]")
      || document.querySelector("button[aria-label*='star this repository' i]")
      || document.querySelector("button[aria-label*='unstar this repository' i]")
    ),
    null,
    { timeout: 30000 }
  );

  const mutated = await page.evaluate(() => {
    const control = document.querySelector("a[aria-label*='star a repository' i], a[aria-label*='unstar this repository' i], button[aria-label*='star this repository' i], button[aria-label*='unstar this repository' i]");
    if (!control) {
      return false;
    }

    control.setAttribute("aria-label", "Unstar this repository");

    const labelNode = [...control.querySelectorAll("span, strong")]
      .find((element) => /star/i.test(element.textContent || ""));
    if (labelNode) {
      labelNode.textContent = labelNode.textContent.replace(/starred/i, "Starred").replace(/star/i, "Starred");
    } else if (!/starred/i.test(control.textContent || "")) {
      control.appendChild(document.createTextNode(" Starred"));
    }

    control.dispatchEvent(new Event("mouseover", { bubbles: true }));
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  });

  assert.equal(mutated, true);

  await page.waitForSelector(".github-star-lists-plus-repo-date", { timeout: 30000 });
  await page.waitForFunction(
    () => Boolean(document.querySelector(".github-star-lists-plus-repo-date")?.textContent?.trim()),
    null,
    { timeout: 30000 }
  );

  const repoState = await page.evaluate(() => {
    const host = document.querySelector(".github-star-lists-plus-repo-date");
    const starControl = document.querySelector("a[aria-label*='unstar this repository' i], button[aria-label*='unstar this repository' i]");
    const hostRect = host?.getBoundingClientRect();
    const anchorRect = host?.previousElementSibling?.getBoundingClientRect();
    const controlRect = starControl?.closest("li")?.getBoundingClientRect() || starControl?.getBoundingClientRect();

    return {
      dateText: host?.textContent?.trim() || "",
      parentTag: host?.parentElement?.tagName || "",
      previousClass: host?.previousElementSibling?.className || "",
      hasRepoPanel: Boolean(document.querySelector(".github-star-lists-plus-repo-panel")),
      hasRepoChips: Boolean(document.querySelector(".github-star-lists-plus-repo-chips")),
      hostRect: hostRect
        ? { left: hostRect.left, top: hostRect.top, right: hostRect.right, bottom: hostRect.bottom }
        : null,
      anchorRect: anchorRect
        ? { left: anchorRect.left, top: anchorRect.top, right: anchorRect.right, bottom: anchorRect.bottom }
        : null,
      controlRect: controlRect
        ? { left: controlRect.left, top: controlRect.top, right: controlRect.right, bottom: controlRect.bottom }
        : null
    };
  });

  assert.equal(repoState.dateText, SEEDED_REPOSITORIES["paperclipai/paperclip"].expectedDateText);
  assert.equal(repoState.parentTag, "LI");
  assert.equal(/BtnGroup/.test(repoState.previousClass), true);
  assert.equal(repoState.hasRepoPanel, false);
  assert.equal(repoState.hasRepoChips, false);
  assert.equal(Boolean(repoState.hostRect && repoState.anchorRect && repoState.controlRect), true);
  assert.equal(repoState.hostRect.left >= repoState.anchorRect.left + 4, true);
  assert.equal(repoState.hostRect.top >= repoState.anchorRect.bottom, true);
  assert.equal(repoState.hostRect.bottom <= repoState.controlRect.bottom + 24, true);

  const screenshotPath = path.join(OUTPUT_DIR, "extension-repo.png");
  await page.screenshot({ path: screenshotPath, fullPage: true, timeout: 30000 });

  return {
    ...repoState,
    screenshotPath
  };
}

(async () => {
  mkdirp(OUTPUT_DIR);
  const profileDir = createProfileDir();
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    executablePath: BROWSER_EXECUTABLE || undefined,
    viewport: { width: 1440, height: 900 },
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      `--disable-extensions-except=${EXTENSION_DIR}`,
      `--load-extension=${EXTENSION_DIR}`,
      "--no-first-run",
      "--no-default-browser-check"
    ]
  });

  try {
    const worker = await waitForExtensionWorker(context);
    const extensionId = new URL(worker.url()).host;
    const seededState = await seedExtensionStorage(worker);
    const page = context.pages()[0] || await context.newPage();

    const starsState = await verifyStarsPage(page);
    const repoState = await verifyRepositoryPage(page);

    console.log(JSON.stringify({
      extensionId,
      seededState,
      starsState,
      repoState
    }, null, 2));
  } finally {
    await context.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
