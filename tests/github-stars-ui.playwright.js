async (page) => {
  const starsUrl = "https://github.com/Fldicoahkiin?tab=stars";
  const repoCacheKey = "github-star-lists-plus-userscript:local:githubStarListsPlusRepoCache";
  const listCatalogKey = "github-star-lists-plus-userscript:local:githubStarListsPlusListCatalog";
  const settingsKey = "github-star-lists-plus-userscript:sync:githubStarListsPlusSettings";
  const screenshotPath = "__ROOT_DIR__/output/playwright/stars-userscript.png";
  const bundle = "__USER_SCRIPT__";
  const apiPayload = [
    {
      starred_at: "2026-01-16T09:59:00Z",
      repo: {
        full_name: "Fldicoahkiin/GithubStarListsPlus"
      }
    },
    {
      starred_at: "2026-01-15T08:30:00Z",
      repo: {
        full_name: "paperclipai/paperclip"
      }
    }
  ];
  const listCatalog = {
    items: [
      {
        id: "llm",
        name: "LLM",
        url: "https://github.com/stars/Fldicoahkiin/lists/llm"
      }
    ],
    updatedAt: Date.now()
  };

  await page.route("https://collector.github.com/**", async (route) => {
    await route.fulfill({ status: 204, body: "" });
  });
  await page.route("https://api.github.com/**", async (route) => {
    const method = route.request().method();
    if (method === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": "https://github.com",
          "access-control-allow-credentials": "true",
          "access-control-allow-methods": "GET, OPTIONS",
          "access-control-allow-headers": "accept, authorization, content-type, x-github-api-version",
          vary: "Origin"
        },
        body: ""
      });
      return;
    }

    if (/\/starred\b/i.test(route.request().url())) {
      await route.fulfill({
        status: 200,
        headers: {
          "access-control-allow-origin": "https://github.com",
          "access-control-allow-credentials": "true",
          "content-type": "application/json; charset=utf-8",
          vary: "Origin"
        },
        body: JSON.stringify(apiPayload)
      });
      return;
    }

    await route.continue();
  });

  await page.goto(starsUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(
    () => document.querySelectorAll("main h3 a[href], main h2 a[href]").length >= 2,
    null,
    { timeout: 30000 }
  );

  const seedRepos = await page.evaluate(() => {
    function parseRepoKey(href) {
      const url = new URL(href, location.origin);
      const parts = url.pathname.split("/").filter(Boolean);
      return parts.length === 2 ? `${parts[0].toLowerCase()}/${parts[1].toLowerCase()}` : "";
    }

    return [...document.querySelectorAll("main h3 a[href], main h2 a[href]")]
      .map((anchor) => parseRepoKey(anchor.href))
      .filter(Boolean)
      .slice(0, 2);
  });

  if (seedRepos.length < 2) {
    throw new Error("Unable to collect repositories from the stars page.");
  }

  await page.context().addInitScript(
    ({ settingsKey, repoCacheKey, listCatalogKey, seedRepos, listCatalog }) => {
      const now = Date.now();

      localStorage.setItem(
        settingsKey,
        JSON.stringify({
          showStarDate: true,
          hideGroupedInAll: true,
          showListBadges: true,
          adaptToTheme: true,
          autoOpenAfterStar: true,
          enableBatchSelection: true,
          token: ""
        })
      );
      localStorage.setItem(
        repoCacheKey,
        JSON.stringify({
          [seedRepos[0]]: {
            starredAt: "2026-01-16T09:59:00Z",
            starCheckedAt: now,
            lists: [],
            listCheckedAt: now
          },
          [seedRepos[1]]: {
            starredAt: "2026-01-15T08:30:00Z",
            starCheckedAt: now,
            lists: [
              {
                id: "llm",
                name: "LLM",
                url: "https://github.com/stars/Fldicoahkiin/lists/llm"
              }
            ],
            listCheckedAt: now
          }
        })
      );
      localStorage.setItem(listCatalogKey, JSON.stringify({ ...listCatalog, updatedAt: now }));
    },
    { settingsKey, repoCacheKey, listCatalogKey, seedRepos, listCatalog }
  );
  await page.context().addInitScript(bundle);

  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1500);
  const controlsState = await page.evaluate(() => {
    const sortTrigger = [...document.querySelectorAll("button, summary")]
      .find((element) => /sort/i.test(element.textContent || "") || /sort/i.test(element.getAttribute("aria-label") || ""));
    const filterButton = document.querySelector("[data-github-star-lists-plus-view-kind='filter']");

    return {
      cards: document.querySelectorAll("main h3 a[href], main h2 a[href]").length,
      sortTriggerText: sortTrigger?.textContent?.trim() || "",
      filterButtonText: filterButton?.textContent?.trim() || "",
      filterButtonVisible: Boolean(filterButton && filterButton.getBoundingClientRect().width > 0 && filterButton.getBoundingClientRect().height > 0),
      currentUrl: location.href
    };
  });
  if (!controlsState.filterButtonVisible) {
    throw new Error(`Stars controls missing: ${JSON.stringify(controlsState)}`);
  }
  await page.waitForFunction(
    ({ seedRepos }) => {
      function parseRepoKey(href) {
        const url = new URL(href, location.origin);
        const parts = url.pathname.split("/").filter(Boolean);
        return parts.length === 2 ? `${parts[0].toLowerCase()}/${parts[1].toLowerCase()}` : "";
      }

      return seedRepos.every((repoKey) => {
        const anchor = [...document.querySelectorAll("main h3 a[href], main h2 a[href]")]
          .find((item) => parseRepoKey(item.href) === repoKey);
        const card = anchor?.closest("li, article, .Box-row, .col-12");
        return Boolean(card?.querySelector(".github-star-lists-plus-native-date"));
      });
    },
    { seedRepos },
    { timeout: 30000 }
  );

  const readRepoOrder = async () => page.evaluate(() => {
    function parseRepoKey(href) {
      const url = new URL(href, location.origin);
      const parts = url.pathname.split("/").filter(Boolean);
      return parts.length === 2 ? `${parts[0].toLowerCase()}/${parts[1].toLowerCase()}` : "";
    }

    return [...document.querySelectorAll("main h3 a[href], main h2 a[href]")]
      .map((anchor) => parseRepoKey(anchor.href))
      .filter(Boolean);
  });

  const initialOrder = await readRepoOrder();
  const debugCache = await page.evaluate(({ repoCacheKey }) => {
    const raw = localStorage.getItem(repoCacheKey) || "";
    try {
      return JSON.parse(raw);
    } catch (_error) {
      return raw;
    }
  }, { repoCacheKey });
  const seededDateTexts = await page.evaluate(({ seedRepos }) => {
    function parseRepoKey(href) {
      const url = new URL(href, location.origin);
      const parts = url.pathname.split("/").filter(Boolean);
      return parts.length === 2 ? `${parts[0].toLowerCase()}/${parts[1].toLowerCase()}` : "";
    }

    return Object.fromEntries(
      seedRepos.map((repoKey) => {
        const anchor = [...document.querySelectorAll("main h3 a[href], main h2 a[href]")]
          .find((item) => parseRepoKey(item.href) === repoKey);
        const card = anchor?.closest("li, article, .Box-row, .col-12");
        const dateText = card?.querySelector(".github-star-lists-plus-native-date")?.textContent?.trim() || "";
        const labelText = card?.querySelector(".github-star-lists-plus-ungrouped-label")?.textContent?.trim() || "";
        return [repoKey, { dateText, labelText }];
      })
    );
  }, { seedRepos });

  if (seededDateTexts[seedRepos[0]]?.dateText !== "2026/01/16 17:59") {
    throw new Error(`Unexpected first seeded date: ${seededDateTexts[seedRepos[0]]?.dateText || "<empty>"} | cache=${JSON.stringify(debugCache)}`);
  }
  if (seededDateTexts[seedRepos[1]]?.dateText !== "2026/01/15 16:30") {
    throw new Error(`Unexpected second seeded date: ${seededDateTexts[seedRepos[1]]?.dateText || "<empty>"} | cache=${JSON.stringify(debugCache)}`);
  }
  if (seededDateTexts[seedRepos[0]]?.labelText !== "Ungrouped") {
    throw new Error("Ungrouped label did not render on the ungrouped card.");
  }
  if (initialOrder.indexOf(seedRepos[0]) === -1 || initialOrder.indexOf(seedRepos[1]) === -1) {
    throw new Error("Seeded repositories are missing from the stars page order.");
  }

  await page.evaluate(() => {
    const trigger = [...document.querySelectorAll("button")].find((button) => /sort by/i.test(button.textContent || ""));
    if (!trigger) {
      throw new Error("Sort trigger not found.");
    }
    trigger.click();
  });

  await page.waitForSelector("[data-github-star-lists-plus-menu-option='star-desc']", { timeout: 10000 });
  await page.waitForSelector("[data-github-star-lists-plus-menu-option='star-asc']", { timeout: 10000 });
  await page.click("[data-github-star-lists-plus-menu-option='star-asc']");
  await page.waitForFunction(
    () => new URL(location.href).searchParams.get("slp-sort") === "star-asc",
    null,
    { timeout: 10000 }
  );
  await page.waitForFunction(
    ({ newestRepo, oldestRepo }) => {
      function parseRepoKey(href) {
        const url = new URL(href, location.origin);
        const parts = url.pathname.split("/").filter(Boolean);
        return parts.length === 2 ? `${parts[0].toLowerCase()}/${parts[1].toLowerCase()}` : "";
      }

      const order = [...document.querySelectorAll("main h3 a[href], main h2 a[href]")]
        .map((anchor) => parseRepoKey(anchor.href))
        .filter(Boolean);
      return order.indexOf(oldestRepo) !== -1
        && order.indexOf(newestRepo) !== -1
        && order.indexOf(oldestRepo) < order.indexOf(newestRepo);
    },
    { newestRepo: seedRepos[0], oldestRepo: seedRepos[1] },
    { timeout: 10000 }
  );

  const sortOrder = await readRepoOrder();

  const hiddenBefore = await page.evaluate(
    ({ groupedRepo }) => {
      function parseRepoKey(href) {
        const url = new URL(href, location.origin);
        const parts = url.pathname.split("/").filter(Boolean);
        return parts.length === 2 ? `${parts[0].toLowerCase()}/${parts[1].toLowerCase()}` : "";
      }

      const anchor = [...document.querySelectorAll("main h3 a[href], main h2 a[href]")]
        .find((item) => parseRepoKey(item.href) === groupedRepo);
      return anchor?.closest("li, article, .Box-row, .col-12")?.classList.contains("github-star-lists-plus-hidden") || false;
    },
    { groupedRepo: seedRepos[1] }
  );

  await page.click("[data-github-star-lists-plus-view-kind='filter']");
  await page.waitForFunction(
    () => new URL(location.href).searchParams.get("slp-filter") === "ungrouped",
    null,
    { timeout: 10000 }
  );
  await page.waitForFunction(
    ({ groupedRepo }) => {
      function parseRepoKey(href) {
        const url = new URL(href, location.origin);
        const parts = url.pathname.split("/").filter(Boolean);
        return parts.length === 2 ? `${parts[0].toLowerCase()}/${parts[1].toLowerCase()}` : "";
      }

      const anchor = [...document.querySelectorAll("main h3 a[href], main h2 a[href]")]
        .find((item) => parseRepoKey(item.href) === groupedRepo);
      return anchor?.closest("li, article, .Box-row, .col-12")?.classList.contains("github-star-lists-plus-hidden") || false;
    },
    { groupedRepo: seedRepos[1] },
    { timeout: 10000 }
  );

  const finalState = await page.evaluate(({ ungroupedRepo, groupedRepo }) => {
    function parseRepoKey(href) {
      const url = new URL(href, location.origin);
      const parts = url.pathname.split("/").filter(Boolean);
      return parts.length === 2 ? `${parts[0].toLowerCase()}/${parts[1].toLowerCase()}` : "";
    }

    function readCardState(repoKey) {
      const anchor = [...document.querySelectorAll("main h3 a[href], main h2 a[href]")]
        .find((item) => parseRepoKey(item.href) === repoKey);
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
      ungroupedRepo: readCardState(ungroupedRepo),
      groupedRepo: readCardState(groupedRepo),
      locationSearch: location.search
    };
  }, { ungroupedRepo: seedRepos[0], groupedRepo: seedRepos[1] });

  if (hiddenBefore) {
    throw new Error("Grouped repository should be visible before the Ungrouped filter is enabled.");
  }
  if (finalState.filterPressed !== "true") {
    throw new Error(`Unexpected filter button state: ${finalState.filterPressed}`);
  }
  if (!finalState.locationSearch.includes("slp-sort=star-asc") || !finalState.locationSearch.includes("slp-filter=ungrouped")) {
    throw new Error(`Stars view state was not synced into the URL: ${finalState.locationSearch}`);
  }
  if (!finalState.groupedRepo.hidden) {
    throw new Error("Grouped repository remained visible after enabling the Ungrouped filter.");
  }
  if (!finalState.ungroupedRepo.labelText) {
    throw new Error("Ungrouped repository label disappeared after filtering.");
  }
  if (!finalState.sortOptions.includes("Star newest") || !finalState.sortOptions.includes("Star oldest")) {
    throw new Error(`Injected sort options missing: ${finalState.sortOptions.join(", ")}`);
  }
  if (sortOrder.indexOf(seedRepos[1]) >= sortOrder.indexOf(seedRepos[0])) {
    throw new Error("Star oldest sorting did not move the older repository ahead of the newer one.");
  }
  if (finalState.paginationLinks.length === 0) {
    throw new Error("Pagination links were not found on the stars page.");
  }
  if (finalState.paginationLinks.some((href) => !href.includes("slp-sort=star-asc") || !href.includes("slp-filter=ungrouped"))) {
    throw new Error(`Pagination links did not retain custom view state: ${finalState.paginationLinks.join(" | ")}`);
  }

  await page.screenshot({ path: screenshotPath, fullPage: true, timeout: 30000 });

  return {
    page: "stars",
    seedRepos,
    initialOrder: initialOrder.slice(0, 8),
    sortOrder: sortOrder.slice(0, 8),
    seededDateTexts,
    filterPressed: finalState.filterPressed,
    sortOptions: finalState.sortOptions,
    paginationLinks: finalState.paginationLinks,
    screenshotPath
  };
}
