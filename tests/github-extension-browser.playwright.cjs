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
const THEME_OPTION_KEY = "theme:browser-extension";
const UNGROUPED_OPTION_KEY = "ungrouped";
const CARD_ROOT_SELECTORS = Object.freeze([
  "div.col-12.d-block.width-full.tmp-py-4.border-bottom.color-border-muted",
  "li.tmp-py-4.border-bottom",
  ".col-12.d-block.width-full.tmp-py-4.border-bottom",
  "article",
  ".Box-row",
  "li",
  ".col-12",
  "div[class*='border-bottom']"
]);

function mkdirp(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function createProfileDir() {
  const profileDir = path.join(OUTPUT_DIR, `chrome-profile-${Date.now()}`);
  mkdirp(profileDir);
  return profileDir;
}

const SEEDED_REPOSITORIES = Object.freeze({
  "fldicoahkiin/githubstarlistsplus": Object.freeze({
    starredAt: "2026-01-16T09:59:00Z",
    expectedDateText: "2026/01/16 17:59",
    lists: Object.freeze([]),
    themeSuggestion: Object.freeze({
      id: "browser-extension",
      name: "Browser Extension",
      score: 2,
      matchedKeywords: Object.freeze(["extension", "userscript"]),
      version: 1,
      updatedAt: 0
    })
  }),
  "paperclipai/paperclip": Object.freeze({
    starredAt: "2026-01-15T08:30:00Z",
    expectedDateText: "2026/01/15 16:30",
    lists: Object.freeze([
      {
        id: "llm",
        name: "LLM",
        url: "https://github.com/stars/Fldicoahkiin/lists/llm"
      }
    ]),
    themeSuggestion: Object.freeze({
      id: "ai-tools",
      name: "AI Tools",
      score: 2,
      matchedKeywords: Object.freeze(["ai", "agent"]),
      version: 1,
      updatedAt: 0
    })
  })
});

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

async function seedExtensionStorage(context, extensionId) {
  const now = Date.now();
  const settings = {
    showStarDate: true,
    hideGroupedInAll: true,
    showListBadges: true,
    showThemeSuggestions: true,
    adaptToTheme: true,
    autoOpenAfterStar: true,
    enableBatchSelection: true,
    themeSuggestionVersion: 1,
    token: ""
  };
  const repoCache = Object.fromEntries(
    Object.entries(SEEDED_REPOSITORIES).map(([repoKey, repo]) => [
      repoKey,
      {
        starredAt: repo.starredAt,
        starCheckedAt: now,
        lists: [...repo.lists],
        listCheckedAt: now,
        themeSuggestion: repo.themeSuggestion || null
      }
    ])
  );
  const listCatalog = {
    items: [...SEEDED_REPOSITORIES["paperclipai/paperclip"].lists],
    updatedAt: now
  };

  const page = await context.newPage();
  try {
    await page.goto(`chrome-extension://${extensionId}/src/options.html`, {
      waitUntil: "load",
      timeout: 30000
    });
    await page.waitForSelector("#saveButton", { timeout: 30000 });

    const seededState = await page.evaluate(async ({ settings, repoCache, listCatalog }) => {
      const storage = globalThis.GithubStarListsPlusStorage;
      if (!storage) {
        throw new Error("GithubStarListsPlusStorage unavailable");
      }

      const savedSettings = await storage.saveSettings(settings);
      const savedCache = await storage.mergeRepoCache(repoCache);
      const savedCatalog = await storage.saveListCatalog(listCatalog.items);

      return {
        settings: savedSettings,
        repoCache: savedCache,
        listCatalog: savedCatalog
      };
    }, {
      settings,
      repoCache,
      listCatalog
    });

    return seededState;
  } finally {
    if (!page.isClosed()) {
      await page.close();
    }
  }
}

async function verifyStarsPage(page) {
  const invalidFilterUrl = `${STARS_URL}&slp-filter=theme:missing&slp-sort=star-asc&page=2#invalid-filter`;

  async function openFilterMenu(targetPage) {
    const isVisible = await targetPage.evaluate(() => {
      const option = document.querySelector("[data-github-star-lists-plus-menu-option='all']");
      if (!option) {
        return false;
      }
      const style = getComputedStyle(option);
      const rect = option.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    });
    if (!isVisible) {
      await targetPage.click("[data-github-star-lists-plus-view-kind='filter']");
    }
    await targetPage.waitForFunction(() => {
      const option = document.querySelector("[data-github-star-lists-plus-menu-option='all']");
      if (!option) {
        return false;
      }
      const style = getComputedStyle(option);
      const rect = option.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    }, null, { timeout: 10000 });
  }

  async function chooseFilterOption(targetPage, optionKey) {
    await openFilterMenu(targetPage);
    await targetPage.click(`[data-github-star-lists-plus-menu-option='${optionKey}'] a, [data-github-star-lists-plus-menu-option='${optionKey}'] button, [data-github-star-lists-plus-menu-option='${optionKey}'][role='menuitemradio']`);
  }

  async function readFilterMenuState(targetPage) {
    return targetPage.evaluate(() => {
      const options = [...document.querySelectorAll("[data-github-star-lists-plus-menu-kind='filter']")]
        .filter((option) => {
          const style = getComputedStyle(option);
          const rect = option.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
        });
      return options.map((option) => {
        const interactive = option.matches("button, a, [role='menuitemradio'], [role='menuitemcheckbox'], [role='option']")
          ? option
          : option.querySelector("button, a, [role='menuitemradio'], [role='menuitemcheckbox'], [role='option']");
        const checkmark = option.querySelector(".ActionListItem-singleSelectCheckmark, .octicon-check");
        return {
          key: option.getAttribute("data-github-star-lists-plus-menu-option") || "",
          text: option.textContent.trim(),
          ariaChecked: interactive?.getAttribute("aria-checked") || "",
          checkmarkHidden: checkmark ? checkmark.hidden : null
        };
      });
    });
  }

  async function waitForRepoHiddenState(targetPage, repoKey, expectedHidden) {
    await targetPage.waitForFunction(({ cardRootSelectors, expectedHidden, repoKey }) => {
      function findCardRoot(anchor) {
        for (const selector of cardRootSelectors) {
          const match = anchor?.closest(selector);
          if (match) {
            return match;
          }
        }
        return null;
      }

      const anchor = [...document.querySelectorAll("main h3 a[href], main h2 a[href]")]
        .find((item) => {
          const parts = new URL(item.href, location.origin).pathname.split("/").filter(Boolean);
          return parts.length === 2 && `${parts[0].toLowerCase()}/${parts[1].toLowerCase()}` === repoKey;
        });
      const card = findCardRoot(anchor);
      if (!card) {
        return false;
      }

      const isHidden = Boolean(
        card.hidden
        || card.classList.contains("github-star-lists-plus-hidden")
        || card.getAttribute("aria-hidden") === "true"
      );

      return isHidden === expectedHidden;
    }, {
      cardRootSelectors: CARD_ROOT_SELECTORS,
      expectedHidden,
      repoKey
    }, {
      timeout: 10000
    });
  }

  await page.goto(invalidFilterUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
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

  const invalidFilterState = await page.evaluate(() => ({
    href: location.href,
    search: location.search,
    hash: location.hash,
    filterButtonText: document.querySelector("[data-github-star-lists-plus-view-kind='filter'] .Button-label")?.textContent?.trim()
      || document.querySelector("[data-github-star-lists-plus-view-kind='filter']")?.textContent?.trim()
      || ""
  }));

  assert.equal(new URL(invalidFilterState.href).searchParams.has("slp-filter"), false);
  assert.equal(new URL(invalidFilterState.href).searchParams.get("slp-sort"), "star-asc");
  assert.equal(new URL(invalidFilterState.href).searchParams.get("page"), "2");
  assert.equal(invalidFilterState.hash, "#invalid-filter");
  assert.equal(invalidFilterState.filterButtonText, "Filter: All");

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

  const initialState = await page.evaluate(({ cardRootSelectors }) => {
    function findCardRoot(anchor) {
      for (const selector of cardRootSelectors) {
        const match = anchor?.closest(selector);
        if (match) {
          return match;
        }
      }
      return null;
    }

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
      const card = findCardRoot(anchor);
      return [repoKey, {
        dateText: card?.querySelector(".github-star-lists-plus-native-date")?.textContent?.trim() || "",
        labelText: card?.querySelector(".github-star-lists-plus-ungrouped-label")?.textContent?.trim() || "",
        themeText: card?.querySelector(".github-star-lists-plus-theme-badge")?.textContent?.trim() || ""
      }];
    }));

    return {
      repoKeys: repoKeys.slice(0, 8),
      seededDateTexts,
      filterButtonText: document.querySelector("[data-github-star-lists-plus-view-kind='filter'] .Button-label")?.textContent?.trim()
        || document.querySelector("[data-github-star-lists-plus-view-kind='filter']")?.textContent?.trim()
        || ""
    };
  }, {
    cardRootSelectors: CARD_ROOT_SELECTORS
  });

  assert.equal(
    initialState.seededDateTexts["fldicoahkiin/githubstarlistsplus"]?.dateText,
    SEEDED_REPOSITORIES["fldicoahkiin/githubstarlistsplus"].expectedDateText
  );
  assert.equal(initialState.seededDateTexts["fldicoahkiin/githubstarlistsplus"]?.labelText, "Ungrouped");
  assert.equal(initialState.seededDateTexts["fldicoahkiin/githubstarlistsplus"]?.themeText, "Theme: Browser Extension");
  assert.equal(
    initialState.seededDateTexts["paperclipai/paperclip"]?.dateText,
    SEEDED_REPOSITORIES["paperclipai/paperclip"].expectedDateText
  );
  assert.equal(initialState.filterButtonText, "Filter: All");

  await page.evaluate(() => {
    const trigger = [...document.querySelectorAll("button")]
      .find((button) => /sort by/i.test(button.textContent || ""));
    if (!trigger) {
      throw new Error("Sort trigger not found.");
    }
    trigger.click();
  });

  await page.waitForSelector("[data-github-star-lists-plus-menu-option='star-asc']", { timeout: 10000 });
  await page.click("[data-github-star-lists-plus-menu-option='star-asc'] a, [data-github-star-lists-plus-menu-option='star-asc'] button, [data-github-star-lists-plus-menu-option='star-asc'][role='menuitemradio']");
  await page.waitForFunction(
    () => new URL(location.href).searchParams.get("slp-sort") === "star-asc",
    null,
    { timeout: 10000 }
  );

  const layoutState = await page.evaluate(() => {
    const filterButton = document.querySelector("[data-github-star-lists-plus-view-kind='filter']");
    const sortButton = [...document.querySelectorAll("button")]
      .find((button) => /sort by/i.test(button.textContent || ""));
    const extraUngroupedButtons = [...document.querySelectorAll("button")]
      .filter((button) => button !== filterButton && /ungrouped/i.test((button.textContent || "").trim()));
    const filterRect = filterButton?.getBoundingClientRect();
    const sortRect = sortButton?.getBoundingClientRect();
    const filterContainer = filterButton?.closest(".d-flex.flex-wrap, .d-flex.flex-justify-end, .subnav, form") || null;
    const sortContainer = sortButton?.closest(".d-flex.flex-wrap, .d-flex.flex-justify-end, .subnav, form") || null;

    return {
      filterParentTag: filterButton?.parentElement?.tagName || "",
      sortParentTag: sortButton?.parentElement?.tagName || "",
      sharesContainer: Boolean(filterContainer && sortContainer && filterContainer === sortContainer),
      filterBeforeSort: Boolean(filterButton && sortButton && (filterButton.compareDocumentPosition(sortButton) & Node.DOCUMENT_POSITION_FOLLOWING)),
      extraUngroupedButtons: extraUngroupedButtons.map((button) => (button.textContent || "").trim()),
      filterButtonTitle: filterButton?.getAttribute("title") || "",
      filterButtonNowrap: filterButton ? getComputedStyle(filterButton).whiteSpace : "",
      desktopSingleLine: Boolean(filterRect && sortRect && filterRect.height <= 40 && sortRect.height <= 40)
    };
  });

  assert.deepEqual(layoutState.extraUngroupedButtons, []);
  assert.equal(layoutState.filterBeforeSort, true);
  assert.equal(layoutState.filterButtonNowrap, "nowrap");
  assert.equal(layoutState.desktopSingleLine, true);

  await openFilterMenu(page);
  const initialMenuState = await readFilterMenuState(page);
  assert.deepEqual(
    initialMenuState.map((option) => option.key),
    ["all", "ungrouped", "theme:claude-mcp", "theme:ai-tools", "theme:browser-extension", "theme:dev-tooling", "theme:security", "theme:design-ui", "theme:desktop-app", "theme:knowledge-collection", "theme:unknown"]
  );
  assert.equal(initialMenuState.every((option) => !option.text.includes("---")), true);
  const allOption = initialMenuState.find((option) => option.key === "all");
  assert.equal(allOption?.ariaChecked, "true");

  await chooseFilterOption(page, UNGROUPED_OPTION_KEY);
  await page.waitForFunction(
    () => new URL(location.href).searchParams.get("slp-filter") === "ungrouped",
    null,
    { timeout: 10000 }
  );

  const ungroupedState = await page.evaluate(() => {
    const menuOption = document.querySelector("[data-github-star-lists-plus-menu-option='all']");
    const menuVisible = Boolean(menuOption && (() => {
      const style = getComputedStyle(menuOption);
      const rect = menuOption.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    })());
    return {
      href: location.href,
      filterButtonText: document.querySelector("[data-github-star-lists-plus-view-kind='filter'] .Button-label")?.textContent?.trim()
        || document.querySelector("[data-github-star-lists-plus-view-kind='filter']")?.textContent?.trim()
        || "",
      menuOpen: menuVisible
    };
  });
  assert.equal(ungroupedState.filterButtonText, "Filter: Ungrouped");

  await openFilterMenu(page);
  const ungroupedMenuState = await readFilterMenuState(page);

  await chooseFilterOption(page, THEME_OPTION_KEY);
  await page.waitForFunction(
    (themeOptionKey) => new URL(location.href).searchParams.get("slp-filter") === themeOptionKey,
    THEME_OPTION_KEY,
    { timeout: 10000 }
  );
  await waitForRepoHiddenState(page, "fldicoahkiin/githubstarlistsplus", false);
  await waitForRepoHiddenState(page, "paperclipai/paperclip", true);

  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(200);

  const finalState = await page.evaluate(({ cardRootSelectors }) => {
    function findCardRoot(anchor) {
      for (const selector of cardRootSelectors) {
        const match = anchor?.closest(selector);
        if (match) {
          return match;
        }
      }
      return null;
    }

    function readCardState(repoKey) {
      const matches = [...document.querySelectorAll("main h3 a[href], main h2 a[href]")]
        .filter((item) => {
          const parts = new URL(item.href, location.origin).pathname.split("/").filter(Boolean);
          return parts.length === 2 && `${parts[0].toLowerCase()}/${parts[1].toLowerCase()}` === repoKey;
        });
      const anchor = matches[0] || null;
      const card = findCardRoot(anchor);
      const hiddenAncestor = anchor?.closest(".github-star-lists-plus-hidden");
      const ancestors = [];
      let cursor = anchor;
      while (cursor && ancestors.length < 6) {
        ancestors.push({
          tag: cursor.tagName,
          className: cursor.className || "",
          hidden: cursor.classList?.contains("github-star-lists-plus-hidden") || false
        });
        cursor = cursor.parentElement;
      }
      return {
        rootClasses: card?.className || "",
        rootDisplay: card ? getComputedStyle(card).display : "",
        rootHiddenAttr: card?.hidden || false,
                  matchCount: matches.length,
        matchTexts: matches.slice(0, 3).map((item) => (item.textContent || "").trim()),
        hidden: card?.classList.contains("github-star-lists-plus-hidden") || false,
        hiddenAncestorTag: hiddenAncestor?.tagName || "",
        hiddenAncestorClass: hiddenAncestor?.className || "",
        dateText: card?.querySelector(".github-star-lists-plus-native-date")?.textContent?.trim() || "",
        labelText: card?.querySelector(".github-star-lists-plus-ungrouped-label")?.textContent?.trim() || "",
        themeText: card?.querySelector(".github-star-lists-plus-theme-badge")?.textContent?.trim() || "",
        ancestors
      };
    }

    const filterButton = document.querySelector("[data-github-star-lists-plus-view-kind='filter']");
    const sortButton = [...document.querySelectorAll("button")]
      .find((button) => /sort by/i.test(button.textContent || ""));
    const filterLabel = filterButton?.querySelector(".Button-label") || filterButton;
    const filterRect = filterButton?.getBoundingClientRect();
    const sortRect = sortButton?.getBoundingClientRect();

    return {
      filterPressed: filterButton?.getAttribute("aria-pressed") || "false",
      sortOptions: [...document.querySelectorAll("[data-github-star-lists-plus-menu-kind='sort']")].map((item) => item.textContent.trim()),
      paginationLinks: [...document.querySelectorAll("nav[aria-label='Pagination'] a, .paginate-container a")].map((anchor) => anchor.href),
      ungroupedRepo: readCardState("fldicoahkiin/githubstarlistsplus"),
      groupedRepo: readCardState("paperclipai/paperclip"),
      locationSearch: location.search,
      filterButtonText: filterLabel?.textContent?.trim() || "",
      filterButtonTitle: filterButton?.getAttribute("title") || "",
      filterLabelClientWidth: filterLabel?.clientWidth || 0,
      filterLabelScrollWidth: filterLabel?.scrollWidth || 0,
      filterButtonHeight: filterRect?.height || 0,
      sortButtonHeight: sortRect?.height || 0,
      sharesParent: Boolean(filterButton && sortButton && filterButton.parentElement === sortButton.parentElement),
      filterBeforeSort: Boolean(filterButton && sortButton && (filterButton.compareDocumentPosition(sortButton) & Node.DOCUMENT_POSITION_FOLLOWING))
    };
  }, {
    cardRootSelectors: CARD_ROOT_SELECTORS
  });

  assert.equal(finalState.filterPressed, "true");
  assert.equal(finalState.ungroupedRepo.labelText, "Ungrouped");
  assert.equal(finalState.ungroupedRepo.themeText, "Theme: Browser Extension");
  assert.equal(finalState.ungroupedRepo.hidden, false);
  assert.equal(finalState.groupedRepo.hidden, true);
  assert.equal(finalState.filterButtonText.includes("Browser Extension"), true);
  assert.equal(finalState.filterButtonTitle.includes("Browser Extension"), true);
  assert.equal(finalState.locationSearch.includes("slp-sort=star-asc"), true);
  assert.equal(new URLSearchParams(finalState.locationSearch).get("slp-filter"), THEME_OPTION_KEY);
  assert.equal(finalState.sortOptions.includes("Star newest"), true);
  assert.equal(finalState.sortOptions.includes("Star oldest"), true);
  assert.equal(finalState.paginationLinks.length > 0, true);
  assert.equal(finalState.paginationLinks.every((href) => {
    const url = new URL(href);
    return url.searchParams.get("slp-sort") === "star-asc" && url.searchParams.get("slp-filter") === THEME_OPTION_KEY;
  }), true);
  assert.equal(finalState.filterBeforeSort, true);
  assert.equal(finalState.filterButtonHeight <= 40, true);
  assert.equal(finalState.sortButtonHeight <= 40, true);
  assert.equal(finalState.filterLabelScrollWidth >= finalState.filterLabelClientWidth, true);

  const screenshotPath = path.join(OUTPUT_DIR, "extension-stars.png");
  await page.screenshot({ path: screenshotPath, fullPage: true, timeout: 30000 });

  return {
    ...finalState,
    screenshotPath
  };
}

async function verifyRepositoryPage(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
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
    const controls = [...document.querySelectorAll(
      "a[aria-label*='star a repository' i], a[aria-label*='unstar this repository' i], button[aria-label*='star this repository' i], button[aria-label*='unstar this repository' i], [data-testid='star-button'], button[data-testid*='star' i], [role='button'][data-testid*='star' i]"
    )];
    if (controls.length === 0) {
      return 0;
    }

    for (const control of controls) {
      control.setAttribute("aria-label", "Unstar this repository");
      control.setAttribute("aria-pressed", "true");

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
    }

    return controls.length;
  });

  assert.equal(mutated > 0, true);

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

  assert.equal(repoState.dateText.includes(SEEDED_REPOSITORIES["paperclipai/paperclip"].expectedDateText), true);
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
    const seededState = await seedExtensionStorage(context, extensionId);
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
