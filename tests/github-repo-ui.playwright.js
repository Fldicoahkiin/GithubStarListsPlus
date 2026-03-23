async (page) => {
  const repoUrl = "https://github.com/paperclipai/paperclip";
  const repoKey = "paperclipai/paperclip";
  const settingsKey = "github-star-lists-plus-userscript:sync:githubStarListsPlusSettings";
  const repoCacheKey = "github-star-lists-plus-userscript:local:githubStarListsPlusRepoCache";
  const screenshotPath = "__ROOT_DIR__/output/playwright/repo-userscript.png";
  const bundle = "__USER_SCRIPT__";
  const apiPayload = [
    {
      starred_at: "2026-01-16T09:59:00Z",
      repo: {
        full_name: "paperclipai/paperclip"
      }
    }
  ];

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

  await page.context().addInitScript(
    ({ settingsKey, repoCacheKey, repoKey }) => {
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
          [repoKey]: {
            starredAt: "2026-01-16T09:59:00Z",
            starCheckedAt: Date.now(),
            lists: []
          }
        })
      );
    },
    { settingsKey, repoCacheKey, repoKey }
  );
  await page.context().addInitScript(bundle);

  await page.goto(repoUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
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

  if (!mutated) {
    throw new Error("Unable to force the repository star control into a starred state.");
  }

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

  if (repoState.dateText !== "2026/01/16 17:59") {
    throw new Error(`Unexpected repository star date: ${repoState.dateText || "<empty>"}`);
  }
  if (repoState.parentTag !== "LI") {
    throw new Error(`Repository date mounted into the wrong container: ${repoState.parentTag}`);
  }
  if (!/BtnGroup/.test(repoState.previousClass)) {
    throw new Error(`Repository date is no longer following the native star control: ${repoState.previousClass}`);
  }
  if (repoState.hasRepoPanel || repoState.hasRepoChips) {
    throw new Error("Repository page rendered extra list management UI.");
  }
  if (!repoState.hostRect || !repoState.anchorRect || !repoState.controlRect) {
    throw new Error("Repository date geometry could not be measured.");
  }
  if (repoState.hostRect.left < repoState.anchorRect.left + 4) {
    throw new Error("Repository date is not indented under the star control.");
  }
  if (repoState.hostRect.top < repoState.anchorRect.bottom) {
    throw new Error("Repository date did not render beneath the native star control row.");
  }
  if (repoState.hostRect.bottom > repoState.controlRect.bottom + 24) {
    throw new Error("Repository date spacing is too loose under the star control.");
  }

  await page.screenshot({ path: screenshotPath, fullPage: true, timeout: 30000 });

  return {
    page: "repository",
    repoKey,
    ...repoState,
    screenshotPath
  };
}
