(() => {
  const core = globalThis.GithubStarListsPlusCore;
  const storage = globalThis.GithubStarListsPlusStorage;
  const STARS_VIEW_QUERY_KEYS = Object.freeze({
    sort: "slp-sort",
    filter: "slp-filter"
  });
  const CUSTOM_STARS_SORT_MODES = new Set(["star-desc", "star-asc"]);

  const state = {
    lastUrl: "",
    routeTimer: 0,
    pageObserver: null,
    pageCleanup: null,
    repoPanelCleanup: null,
    batchPanelCleanup: null,
    cards: [],
    bootstrapped: false,
    starDatesReady: false,
    selectedKeys: new Set(),
    lastSelectedIndex: -1,
    view: {
      filter: "all",
      filterDirty: false,
      search: "",
      sort: "default"
    }
  };

  function sendRuntimeMessage(message) {
    return core.callChrome(core.runtimeApi.runtime, "sendMessage", [message]);
  }

  function isVisible(element) {
    if (!element) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    const style = globalThis.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  }

  function normalizeText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isStarsPage() {
    if (location.origin !== "https://github.com") return false;
    if (location.pathname === "/stars" || location.pathname.startsWith("/stars/")) return true;
    if (location.search.includes("tab=stars")) return true;
    return Boolean(currentListIdentity());
  }

  function isRepositoryPage() {
    if (isStarsPage()) return false;
    return Boolean(core.readRepositoryNwo());
  }

  const GENERIC_LIST_PATHS = ["/trending", "/topics", "/search", "/explore", "/collections"];

  function isGenericRepoListPage() {
    if (isStarsPage() || isRepositoryPage()) return false;
    const path = location.pathname;
    return GENERIC_LIST_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  }

  function getTargetStarsUser() {
    if (location.pathname === "/stars" || location.pathname.startsWith("/stars/")) {
      return core.readUserLogin();
    }
    const match = location.pathname.match(/^\/([^/]+)$/);
    if (match && location.search.includes("tab=stars")) {
      return match[1];
    }
    return core.readUserLogin();
  }

  function currentListIdentity() {
    return core.parseListIdentity(location.href);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function dedupeBy(items, getKey) {
    const seen = new Set();
    const result = [];

    for (const item of items) {
      const key = getKey(item);
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push(item);
    }

    return result;
  }

  function cleanupPage() {
    closeBatchListPanel();

    if (typeof state.pageCleanup === "function") {
      state.pageCleanup();
      state.pageCleanup = null;
    }

    if (state.pageObserver) {
      state.pageObserver.disconnect();
      state.pageObserver = null;
    }

    state.cards = [];
    state.starDatesReady = false;
    state.selectedKeys.clear();
    state.lastSelectedIndex = -1;
  }

  function scheduleRouteRefresh() {
    clearTimeout(state.routeTimer);
    state.routeTimer = globalThis.setTimeout(() => {
      refreshRoute().catch((error) => {
        console.error("GitHub StarLists++ route refresh failed", error);
      });
    }, 120);
  }

  function watchRouteChanges() {
    const routeEvents = ["pjax:end", "turbo:load", "popstate"];
    for (const eventName of routeEvents) {
      document.addEventListener(eventName, scheduleRouteRefresh, true);
    }

    let observer = null;
    const handleMutation = () => {
      if (location.href !== state.lastUrl) {
        scheduleRouteRefresh();
      }
    };
    const attachObserver = () => {
      if (observer || !document.documentElement) {
        if (!observer && !document.documentElement) {
          globalThis.setTimeout(attachObserver, 0);
        }
        return;
      }

      observer = new MutationObserver(handleMutation);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
    };

    attachObserver();
  }

  async function refreshRoute() {
    if (location.href === state.lastUrl && state.pageCleanup) {
      return;
    }

    state.lastUrl = location.href;
    cleanupPage();

    if (isStarsPage()) {
      await setupStarsPage();
      return;
    }

    if (isRepositoryPage()) {
      await setupRepositoryPage();
      return;
    }

    if (isGenericRepoListPage()) {
      await setupGenericListPage();
    }
  }

  function extractCardRoot(element) {
    return element?.closest(
      "li.tmp-py-4.border-bottom, .col-12.d-block.width-full.tmp-py-4.border-bottom, article, .Box-row, li, .col-12, div[class*='border-bottom']"
    ) || null;
  }

  function findRepoLink(root) {
    if (!root) {
      return null;
    }

    const candidates = [...root.querySelectorAll("a[href]")];
    return candidates.find((anchor) => core.parseRepositoryUrl(anchor.href));
  }

  function extractCardDescription(root) {
    const paragraph = root?.querySelector("p, .color-fg-muted, .wb-break-word");
    return paragraph?.textContent?.trim() || "";
  }

  function findStarRelatedTimeElement(scopeRoot) {
    const timeEls = [...scopeRoot?.querySelectorAll("relative-time[datetime], time[datetime]") || []];

    for (const timeEl of timeEls) {
      const directContext = normalizeText(
        `${timeEl.parentElement?.textContent || ""} ${timeEl.closest("span, div, p, li")?.textContent || ""}`
      ).toLowerCase();
      const previousText = normalizeText(timeEl.previousSibling?.textContent || "").toLowerCase();
      if (directContext.includes("starred") || previousText.includes("starred")) {
        return timeEl;
      }
    }

    return null;
  }

  function extractStarDateFromDom(root) {
    return findStarRelatedTimeElement(root)?.getAttribute("datetime") || "";
  }

  function extractStarDateMapFromDocument(doc, repoKeys) {
    const wantedKeys = Array.isArray(repoKeys) && repoKeys.length > 0
      ? new Set(repoKeys.map((repoKey) => String(repoKey || "").toLowerCase()))
      : null;
    const anchors = [...doc.querySelectorAll("a[href]")];
    const seenRoots = new Set();
    const result = {};

    for (const anchor of anchors) {
      const repoInfo = core.parseRepositoryUrl(anchor.href);
      if (!repoInfo || (wantedKeys && !wantedKeys.has(repoInfo.key))) {
        continue;
      }

      const root = extractCardRoot(anchor);
      if (!root || seenRoots.has(root)) {
        continue;
      }

      seenRoots.add(root);
      const starredAt = extractStarDateFromDom(root);
      if (starredAt) {
        result[repoInfo.key] = starredAt;
      }
    }

    return result;
  }

  function buildStarsRepositoriesUrl(username, options = {}) {
    if (!username) {
      return "";
    }

    const url = new URL(`/stars/${encodeURIComponent(username)}/repositories`, location.origin);
    url.searchParams.set("filter", "all");

    if (options.pageHint) {
      url.searchParams.set("page", String(options.pageHint));
    }

    if (options.query) {
      url.searchParams.set("q", String(options.query).trim());
    }

    return url.toString();
  }

  function collectStarCards() {
    const main = document.querySelector("main");
    if (!main) {
      return [];
    }

    const starForms = [...main.querySelectorAll("form[action*='/star'], form[action*='/unstar']")];
    const repoHeadings = [...main.querySelectorAll("h1 a[href], h2 a[href], h3 a[href]")];
    const candidates = [...starForms, ...repoHeadings];
    const cards = [];
    const seenRoots = new Set();
    const seenKeys = new Set();

    for (const candidate of candidates) {
      const root = extractCardRoot(candidate);
      if (!root || seenRoots.has(root)) {
        continue;
      }

      const repoLink = candidate.matches?.("a[href]") ? candidate : findRepoLink(root);
      const repoInfo = repoLink ? core.parseRepositoryUrl(repoLink.href) : null;
      if (!repoInfo || seenKeys.has(repoInfo.key)) {
        continue;
      }

      seenRoots.add(root);
      seenKeys.add(repoInfo.key);
      cards.push({
        root,
        starForm: root.querySelector("form[action*='/star'], form[action*='/unstar']") || null,
        key: repoInfo.key,
        owner: repoInfo.owner,
        repo: repoInfo.repo,
        repoLink,
        description: extractCardDescription(root),
        domStarredAt: extractStarDateFromDom(root),
        domOrder: cards.length
      });
    }

    return cards;
  }

  function findCardInfoRow(card) {
    const nativeTime = findStarRelatedTimeElement(card.root);
    if (nativeTime) {
      const row = nativeTime.closest("div, p, li, span");
      if (row && card.root.contains(row)) {
        return row;
      }
    }

    return card.root.querySelector(
      ".f6.color-fg-muted.mt-2, p.color-fg-muted.text-small, div.color-fg-muted.text-small, .text-small.color-fg-muted, .color-fg-muted.f6"
    );
  }

  function findCardNativeTime(card) {
    const directMatch = findStarRelatedTimeElement(card.root);
    if (directMatch) {
      return directMatch;
    }

    const row = findCardInfoRow(card);
    if (!row) {
      return null;
    }

    const candidates = [...row.querySelectorAll("relative-time[datetime], time[datetime]")];
    return candidates[candidates.length - 1] || null;
  }

  function clearNativeDateLabel(timeEl) {
    if (!timeEl) {
      return;
    }

    const previousTextNode = timeEl.previousSibling;
    if (previousTextNode?.nodeType === Node.TEXT_NODE && /\b(updated|starred)\b/i.test(previousTextNode.textContent || "")) {
      previousTextNode.textContent = previousTextNode.textContent.replace(/\b(updated|starred)\b\s*/gi, "");
      return;
    }

    const previousElement = timeEl.previousElementSibling;
    if (previousElement && /^(updated|starred)$/i.test(normalizeText(previousElement.textContent))) {
      previousElement.remove();
    }
  }

  function ensureCardDateHost(card) {
    let host = card.root.querySelector(".github-star-lists-plus-native-date");
    if (host) {
      return host;
    }

    const row = findCardInfoRow(card);
    if (!row) {
      return null;
    }

    const nativeTime = findCardNativeTime(card);
    if (nativeTime) {
      clearNativeDateLabel(nativeTime);
      nativeTime.style.display = "none";
    }

    host = document.createElement("span");
    host.className = "github-star-lists-plus-native-date no-wrap";

    if (!row.style.display || row.style.display === "block") {
      const computed = globalThis.getComputedStyle(row).display;
      if (computed !== "flex" && computed !== "inline-flex") {
        row.style.display = "flex";
        row.style.flexWrap = "wrap";
        row.style.alignItems = "center";
      }
    }

    row.appendChild(host);
    return host;
  }

  function ensureCardLabelHost(card) {
    const row = findCardInfoRow(card);
    if (!row) {
      return null;
    }

    let host = row.querySelector(".github-star-lists-plus-card-label-slot");
    if (!host) {
      host = document.createElement("span");
      host.className = "github-star-lists-plus-card-label-slot";
      row.appendChild(host);
    }

    return host;
  }

  function renderCardStarDate(card, cacheEntry) {
    if (!state.settings?.showStarDate) {
      return;
    }

    const starredAt = cacheEntry?.starredAt || card.domStarredAt || "";
    if (!starredAt) {
      return;
    }

    const host = ensureCardDateHost(card);
    if (host) {
      host.textContent = core.formatStarDate(starredAt);
    }
  }

  function getCardListCount(cacheEntry) {
    const listCount = Array.isArray(cacheEntry?.lists) ? cacheEntry.lists.length : 0;
    return currentListIdentity() ? Math.max(1, listCount) : listCount;
  }

  function renderCardListLabel(card, cacheEntry) {
    const existingHost = card.root.querySelector(".github-star-lists-plus-card-label-slot");
    const listCount = getCardListCount(cacheEntry);
    const showUngrouped = Boolean(state.settings?.showListBadges) && listCount === 0;

    if (!showUngrouped) {
      existingHost?.remove();
      return;
    }

    const host = ensureCardLabelHost(card);
    if (!host) {
      return;
    }

    host.innerHTML = `<span class="github-star-lists-plus-ungrouped-label">Ungrouped</span>`;
  }

  function renderCardMeta(card, cacheEntry) {
    renderCardStarDate(card, cacheEntry);
    renderCardListLabel(card, cacheEntry);
  }

  function ensureSelectionControl(card, index) {
    if (!card.starForm || !card.repoLink || !card.repoLink.parentElement) {
      return;
    }

    const heading = card.repoLink.closest("h1, h2, h3") || card.repoLink.parentElement;
    let checkbox = heading.querySelector(".github-star-lists-plus-card-select input");
    if (checkbox) {
      checkbox.checked = state.selectedKeys.has(card.key);
      return;
    }

    const wrapper = document.createElement("label");
    wrapper.className = "github-star-lists-plus-card-select";
    wrapper.title = "Select repository for batch actions";

    checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.repoKey = card.key;
    checkbox.addEventListener("click", (event) => {
      event.stopPropagation();
      handleSelectionToggle(card, index, checkbox.checked, event);
    });

    wrapper.appendChild(checkbox);
    heading.insertBefore(wrapper, heading.firstChild);
  }

  function handleSelectionToggle(card, index, checked, event) {
    if (event.shiftKey && state.lastSelectedIndex >= 0) {
      const start = Math.min(state.lastSelectedIndex, index);
      const end = Math.max(state.lastSelectedIndex, index);
      for (let cursor = start; cursor <= end; cursor += 1) {
        const targetCard = state.cards[cursor];
        if (!targetCard) {
          continue;
        }
        if (checked) {
          state.selectedKeys.add(targetCard.key);
        } else {
          state.selectedKeys.delete(targetCard.key);
        }
        updateCardSelection(targetCard);
      }
    } else {
      if (checked) {
        state.selectedKeys.add(card.key);
      } else {
        state.selectedKeys.delete(card.key);
      }
      updateCardSelection(card);
      state.lastSelectedIndex = index;
    }

    syncBatchToolbar();
  }

  function updateCardSelection(card) {
    const checked = state.selectedKeys.has(card.key);
    card.root.classList.toggle("github-star-lists-plus-card-selected", checked);
    const input = card.root.querySelector(".github-star-lists-plus-card-select input");
    if (input) {
      input.checked = checked;
    }
  }

  function findCardByKey(repoKey) {
    return state.cards.find((card) => card.key === repoKey) || null;
  }

  function setSelectionForKeys(repoKeys, checked) {
    for (const repoKey of repoKeys) {
      const card = findCardByKey(repoKey);
      if (!card) {
        continue;
      }

      if (checked) {
        state.selectedKeys.add(repoKey);
      } else {
        state.selectedKeys.delete(repoKey);
      }

      updateCardSelection(card);
    }
  }

  function syncBatchToolbar() {
    const toolbar = document.querySelector(".github-star-lists-plus-batch-toolbar");
    if (!toolbar) {
      return;
    }

    const count = state.selectedKeys.size;
    const hasLists = Array.isArray(state.listCatalog) && state.listCatalog.length > 0;
    toolbar.classList.toggle("is-visible", count > 0);
    toolbar.querySelector("[data-role='count']").textContent = `${count} selected`;
    toolbar.querySelector("button[data-action='add-lists']").disabled = count === 0 || !hasLists;
    toolbar.querySelector("button[data-action='remove-lists']").disabled = count === 0 || !hasLists;
    toolbar.querySelector("button[data-action='unstar']").disabled = count === 0;
    toolbar.querySelector("button[data-action='clear']").disabled = count === 0;

    if (count === 0) {
      closeBatchListPanel();
    }
  }

  function discoverListCatalogFromDocument() {
    const anchors = [...document.querySelectorAll("a[href]")];
    const items = [];

    for (const anchor of anchors) {
      const identity = core.parseListIdentity(anchor.href);
      if (!identity) {
        continue;
      }

      const name = anchor.textContent.trim() || identity.id;
      if (!name || /^lists?$/i.test(name)) {
        continue;
      }

      items.push({
        id: identity.id,
        name,
        url: identity.url
      });
    }

    return dedupeBy(items, (item) => item.id);
  }

  async function loadListCatalog() {
    const documentItems = discoverListCatalogFromDocument();
    if (documentItems.length > 0) {
      await storage.saveListCatalog(documentItems);
      return documentItems;
    }

    const cachedCatalog = await storage.getListCatalog();
    return Array.isArray(cachedCatalog.items) ? cachedCatalog.items : [];
  }

  function extractRepoKeysFromDocument(doc) {
    const anchors = [...doc.querySelectorAll("a[href]")];
    const result = new Set();

    for (const anchor of anchors) {
      const repoInfo = core.parseRepositoryUrl(anchor.href);
      if (repoInfo) {
        result.add(repoInfo.key);
      }
    }

    return result;
  }

  function findNextPageUrl(doc) {
    const nextAnchor = doc.querySelector("a[rel='next'], a.next_page");
    if (!nextAnchor) {
      return "";
    }

    try {
      return new URL(nextAnchor.getAttribute("href"), location.origin).toString();
    } catch (_error) {
      return "";
    }
  }

  async function crawlListMembership(repoKeys, listCatalog) {
    if (!Array.isArray(repoKeys) || repoKeys.length === 0 || !Array.isArray(listCatalog) || listCatalog.length === 0) {
      return {};
    }

    const result = repoKeys.reduce((map, repoKey) => {
      map[repoKey] = [];
      return map;
    }, {});
    const domParser = new DOMParser();
    const listsToScan = listCatalog.slice(0, 12);

    for (const list of listsToScan) {
      let pageUrl = list.url;
      let pageCount = 0;

      while (pageUrl && pageCount < 6) {
        let response;
        try {
          response = await fetch(pageUrl, {
            credentials: "include"
          });
        } catch (_error) {
          break;
        }

        if (!response.ok) {
          break;
        }

        const html = await response.text();
        const doc = domParser.parseFromString(html, "text/html");
        const keys = extractRepoKeysFromDocument(doc);
        for (const repoKey of keys) {
          if (!Object.hasOwn(result, repoKey)) {
            continue;
          }

          result[repoKey].push({
            id: list.id,
            name: list.name,
            url: list.url
          });
        }

        pageUrl = findNextPageUrl(doc);
        pageCount += 1;
      }
    }

    return result;
  }

  async function hydrateRepoLists(cards, listCatalog) {
    const repoKeys = cards.map((card) => card.key);
    const cachedEntries = await storage.getRepoCacheEntries(repoKeys);
    const now = Date.now();
    const twelveHours = 12 * 60 * 60 * 1000;
    const missing = [];

    for (const card of cards) {
      const cached = cachedEntries[card.key] || {};
      renderCardMeta(card, cached);
      if (!cached.listCheckedAt || now - cached.listCheckedAt > twelveHours) {
        missing.push(card.key);
      }
    }

    if (missing.length === 0 || !Array.isArray(listCatalog) || listCatalog.length === 0) {
      return cachedEntries;
    }

    const crawled = await crawlListMembership(missing, listCatalog);
    const patch = {};

    for (const repoKey of missing) {
      patch[repoKey] = {
        ...(cachedEntries[repoKey] || {}),
        lists: dedupeBy(crawled[repoKey] || [], (item) => item.id),
        listCheckedAt: now
      };
    }

    if (Object.keys(patch).length > 0) {
      await storage.mergeRepoCache(patch);
    }

    const merged = {
      ...cachedEntries,
      ...patch
    };

    for (const card of cards) {
      renderCardMeta(card, merged[card.key] || {});
    }

    return merged;
  }

  async function hydrateStarDates(cards) {
    const repoKeys = cards.map((card) => card.key);
    const cachedEntries = await storage.getRepoCacheEntries(repoKeys);
    const patch = {};
    const missing = [];
    const pageHint = Number(new URL(location.href).searchParams.get("page") || 1);
    const searchQuery = new URL(location.href).searchParams.get("q") || "";
    const starsUsername = getTargetStarsUser();

    // Extract dates from DOM relative-time[datetime] elements first
    for (const card of cards) {
      const cached = cachedEntries[card.key];
      if (cached?.starredAt) {
        continue;
      }

      if (card.domStarredAt) {
        patch[card.key] = {
          ...(cached || {}),
          starredAt: card.domStarredAt,
          starCheckedAt: Date.now()
        };
      } else {
        missing.push(card.key);
      }
    }

    // Fetch remaining missing dates via API
    if (missing.length > 0) {
      try {
        const response = await sendRuntimeMessage({
          type: core.MESSAGE_TYPES.getStarMetadata,
          repoKeys: missing,
          pageHint,
          username: starsUsername
        });

        if (response?.ok && response.data) {
          for (const repoKey of missing) {
            const starredAt = response.data[repoKey];
            if (!starredAt) {
              continue;
            }

            patch[repoKey] = {
              ...(cachedEntries[repoKey] || {}),
              starredAt,
              starCheckedAt: Date.now()
            };
          }
        }
      } catch (_error) {
        // Silently ignore API fallback failures
      }
    }

    const unresolved = missing.filter((repoKey) => !(patch[repoKey]?.starredAt));
    if (unresolved.length > 0 && starsUsername) {
      try {
        const pageUrl = buildStarsRepositoriesUrl(starsUsername, {
          pageHint,
          query: searchQuery
        });

        if (pageUrl) {
          const response = await fetch(pageUrl, {
            credentials: "include"
          });

          if (response.ok) {
            const html = await response.text();
            const doc = new DOMParser().parseFromString(html, "text/html");
            const matchedDates = extractStarDateMapFromDocument(doc, unresolved);

            for (const repoKey of unresolved) {
              const starredAt = matchedDates[repoKey];
              if (!starredAt) {
                continue;
              }

              patch[repoKey] = {
                ...(patch[repoKey] || cachedEntries[repoKey] || {}),
                starredAt,
                starCheckedAt: Date.now()
              };
            }
          }
        }
      } catch (_error) {
        // Silently ignore HTML fallback failures
      }
    }

    const unresolvedAfterPage = missing.filter((repoKey) => !(patch[repoKey]?.starredAt));
    for (const repoKey of unresolvedAfterPage) {
      const starredAt = await fetchStarDateFromStarsSearch(repoKey, starsUsername);
      if (!starredAt) {
        continue;
      }

      patch[repoKey] = {
        ...(patch[repoKey] || cachedEntries[repoKey] || {}),
        starredAt,
        starCheckedAt: Date.now()
      };
    }

    if (Object.keys(patch).length > 0) {
      await storage.mergeRepoCache(patch);
    }
  }

  async function ensureStarDatesReady() {
    if (state.starDatesReady || !Array.isArray(state.cards) || state.cards.length === 0) {
      return;
    }

    await hydrateStarDates(state.cards);
    state.repoCache = await storage.getRepoCacheEntries(state.cards.map((card) => card.key));
    state.starDatesReady = true;

    if (state.settings?.showStarDate) {
      for (const card of state.cards) {
        renderCardMeta(card, state.repoCache?.[card.key] || {});
      }
    }
  }

  function extractSearchableText(card, cacheEntry) {
    const listNames = (cacheEntry?.lists || []).map((item) => item.name).join(" ");
    return `${card.owner} ${card.repo} ${card.description} ${listNames}`.toLowerCase();
  }

  function readCardStarTimestamp(card) {
    const timestamp = new Date(state.repoCache?.[card.key]?.starredAt || card.domStarredAt || 0).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  function compareCardsByActiveSort(left, right) {
    if (state.view.sort === "star-desc" || state.view.sort === "star-asc") {
      const leftValue = readCardStarTimestamp(left);
      const rightValue = readCardStarTimestamp(right);

      if (leftValue !== rightValue) {
        return state.view.sort === "star-asc"
          ? leftValue - rightValue
          : rightValue - leftValue;
      }
    }

    return (left.domOrder || 0) - (right.domOrder || 0);
  }

  function sortCardsInDom() {
    if (!Array.isArray(state.cards) || state.cards.length === 0) {
      return;
    }

    const cardsByParent = new Map();
    for (const card of state.cards) {
      const parent = card.root?.parentElement;
      if (!parent) {
        continue;
      }

      if (!cardsByParent.has(parent)) {
        cardsByParent.set(parent, []);
      }
      cardsByParent.get(parent).push(card);
    }

    for (const [parent, cards] of cardsByParent.entries()) {
      const originalCards = [...cards].sort((left, right) => (left.domOrder || 0) - (right.domOrder || 0));
      const boundary = originalCards[originalCards.length - 1]?.root?.nextSibling || null;
      const sortedCards = [...cards].sort(compareCardsByActiveSort);

      for (const card of sortedCards) {
        parent.insertBefore(card.root, boundary);
      }
    }
  }

  function applyCardFilters() {
    const filterMode = state.view.filter;
    const cards = [...state.cards];

    for (const card of cards) {
      const cacheEntry = state.repoCache?.[card.key] || {};
      const listCount = getCardListCount(cacheEntry);
      let visible = true;

      if (filterMode === "ungrouped") {
        visible = listCount === 0;
      }

      card.root.classList.toggle("github-star-lists-plus-hidden", !visible);
    }

    sortCardsInDom();
  }

  function findTopControlsMount() {
    const searchInput = document.querySelector(
      "input[name='q'], input[data-test-selector='stars-repo-filter'], input[id*='-filter'], input[placeholder*='Search stars' i], input[aria-label*='Search stars' i], input[type='search'][placeholder*='Search' i]"
    );
    const searchForm = searchInput?.closest("form");
    if (searchInput) {
      const scopes = [];
      let cursor = searchForm?.parentElement || searchInput.parentElement;

      while (cursor && cursor !== document.body && scopes.length < 6) {
        scopes.push(cursor);
        cursor = cursor.parentElement;
      }

      for (const scope of scopes) {
        const sortCandidates = [...scope.querySelectorAll("button, summary")].filter((element) => {
          const text = normalizeText(
            `${element.textContent || ""} ${element.getAttribute("aria-label") || ""} ${element.getAttribute("title") || ""}`
          ).toLowerCase();
          return text.includes("sort");
        });

        if (sortCandidates.length === 0) {
          continue;
        }

        const sortTrigger = sortCandidates
          .sort((left, right) => scoreStarsMenuTrigger(right, "sort", scope) - scoreStarsMenuTrigger(left, "sort", scope))[0];
        const container = sortTrigger?.parentElement || scope;
        if (container) {
          return {
            container,
            before: sortTrigger
          };
        }
      }
    }

    const sortButton = document.querySelector("#stars-sort-menu-button, button[id*='sort-menu-button'], details summary");
    const container = sortButton?.closest(".d-flex.flex-justify-end, .d-flex.flex-wrap, .subnav, form") || null;
    let before = null;
    if (container && sortButton) {
      let cursor = sortButton;
      while (cursor && cursor.parentElement !== container) {
        cursor = cursor.parentElement;
      }
      before = cursor || null;
    }

    return {
      container,
      before
    };
  }

  function getDefaultStarsFilter() {
    return "all";
  }

  function readStarsViewFromUrl() {
    const url = new URL(location.href);
    const sortValue = url.searchParams.get(STARS_VIEW_QUERY_KEYS.sort) || "";
    const filterValue = url.searchParams.get(STARS_VIEW_QUERY_KEYS.filter) || "";

    return {
      sort: CUSTOM_STARS_SORT_MODES.has(sortValue) ? sortValue : "default",
      filter: filterValue === "ungrouped" ? "ungrouped" : "all",
      hasCustomFilter: url.searchParams.has(STARS_VIEW_QUERY_KEYS.filter)
    };
  }

  function syncStarsViewToUrl() {
    const url = new URL(location.href);
    const defaultFilter = getDefaultStarsFilter();
    const activeFilter = currentListIdentity() ? "all" : (state.view.filter || "all");

    if (state.view.sort === "default") {
      url.searchParams.delete(STARS_VIEW_QUERY_KEYS.sort);
    } else {
      url.searchParams.set(STARS_VIEW_QUERY_KEYS.sort, state.view.sort);
    }

    if (activeFilter === defaultFilter) {
      url.searchParams.delete(STARS_VIEW_QUERY_KEYS.filter);
    } else {
      url.searchParams.set(STARS_VIEW_QUERY_KEYS.filter, activeFilter);
    }

    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    const currentUrl = `${location.pathname}${location.search}${location.hash}`;
    if (nextUrl !== currentUrl) {
      history.replaceState(history.state, "", nextUrl);
      state.lastUrl = location.href;
    }
  }

  function syncPaginationLinks() {
    const defaultFilter = getDefaultStarsFilter();
    const activeFilter = currentListIdentity() ? "all" : (state.view.filter || "all");
    const anchors = document.querySelectorAll("a[rel='next'], a[rel='prev'], .paginate-container a, nav[aria-label='Pagination'] a");

    for (const anchor of anchors) {
      const href = anchor.getAttribute("href");
      if (!href) {
        continue;
      }

      let url;
      try {
        url = new URL(href, location.origin);
      } catch (_error) {
        continue;
      }

      if (url.origin !== location.origin) {
        continue;
      }

      if (state.view.sort === "default") {
        url.searchParams.delete(STARS_VIEW_QUERY_KEYS.sort);
      } else {
        url.searchParams.set(STARS_VIEW_QUERY_KEYS.sort, state.view.sort);
      }

      if (activeFilter === defaultFilter) {
        url.searchParams.delete(STARS_VIEW_QUERY_KEYS.filter);
      } else {
        url.searchParams.set(STARS_VIEW_QUERY_KEYS.filter, activeFilter);
      }

      anchor.href = `${url.pathname}${url.search}${url.hash}`;
    }
  }

  function getActiveStarsSortLabel() {
    if (state.view.sort === "star-desc") {
      return "Star newest";
    }
    if (state.view.sort === "star-asc") {
      return "Star oldest";
    }
    return "";
  }

  function syncStarsSortTriggerLabel() {
    const trigger = findStarsMenuTrigger("sort");
    if (!trigger) {
      return;
    }

    const modernLabel = trigger.querySelector(".Button-label");
    if (modernLabel) {
      if (!modernLabel.dataset.githubStarListsPlusDefaultLabel) {
        modernLabel.dataset.githubStarListsPlusDefaultLabel = normalizeText(modernLabel.textContent);
      }

      modernLabel.textContent = getActiveStarsSortLabel()
        ? `Sort by: ${getActiveStarsSortLabel()}`
        : modernLabel.dataset.githubStarListsPlusDefaultLabel;
      return;
    }

    const legacyLabel = trigger.querySelector("[data-menu-button]");
    if (!legacyLabel) {
      return;
    }

    if (!legacyLabel.dataset.githubStarListsPlusDefaultLabel) {
      legacyLabel.dataset.githubStarListsPlusDefaultLabel = normalizeText(legacyLabel.textContent);
    }

    legacyLabel.textContent = getActiveStarsSortLabel() || legacyLabel.dataset.githubStarListsPlusDefaultLabel;
  }

  function resolveStarsViewButtonMount() {
    const mount = findTopControlsMount();
    if (!mount?.container) {
      return null;
    }

    const sortTrigger = findStarsMenuTrigger("sort");
    let before = null;
    if (sortTrigger) {
      before = sortTrigger;
      while (before && before.parentElement !== mount.container) {
        before = before.parentElement;
      }
    }

    return {
      container: mount.container,
      before: before || mount.before || null
    };
  }

  function createStarsViewButton(kind) {
    const sortTrigger = findStarsMenuTrigger("sort");
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.githubStarListsPlusViewKind = kind;
    button.classList.add("github-star-lists-plus-view-button");

    if (sortTrigger?.matches("button")) {
      button.className = `${sortTrigger.className} ml-2 mb-1 mb-lg-0 github-star-lists-plus-view-button`;
      button.innerHTML = `
        <span class="Button-content">
          <span class="Button-visual Button-visual--leading github-star-lists-plus-view-button-icon" hidden aria-hidden="true">
            <svg aria-hidden="true" height="16" viewBox="0 0 16 16" version="1.1" width="16" data-view-component="true" class="octicon octicon-check">
              <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path>
            </svg>
          </span>
          <span class="Button-label"></span>
        </span>
      `;
    } else {
      button.className = "btn ml-2 mb-1 mb-lg-0 github-star-lists-plus-view-button";
    }

    return button;
  }

  function syncStarsFilterButton(button) {
    const filterActive = !currentListIdentity() && state.view.filter === "ungrouped";
    button.classList.toggle("is-active", filterActive);
    button.setAttribute("aria-pressed", String(filterActive));
    button.dataset.checked = filterActive ? "true" : "false";
    button.title = filterActive ? "Show all starred repositories" : "Show only ungrouped repositories";
    const icon = button.querySelector(".github-star-lists-plus-view-button-icon");
    if (icon) {
      icon.hidden = !filterActive;
    }

    const label = button.querySelector(".Button-label");
    if (label) {
      label.textContent = "Ungrouped";
      return;
    }

    button.textContent = "Ungrouped";
  }

  function ensureStarsFilterButton() {
    if (currentListIdentity()) {
      return;
    }

    const mount = resolveStarsViewButtonMount();
    if (!mount?.container) {
      return;
    }

    let button = mount.container.querySelector("[data-github-star-lists-plus-view-kind='filter']");
    if (!button) {
      button = createStarsViewButton("filter");
      button.addEventListener("click", async () => {
        state.view.filter = state.view.filter === "ungrouped" ? "all" : "ungrouped";
        await applyStarsViewState();
      });
    }

    if (button.parentElement !== mount.container || button.nextElementSibling !== mount.before) {
      mount.container.insertBefore(button, mount.before);
    }

    syncStarsFilterButton(button);
  }

  function scoreStarsMenuTrigger(trigger, kind, scopeRoot) {
    if (!trigger || !isVisible(trigger)) {
      return -1;
    }

    const text = normalizeText(
      `${trigger.textContent || ""} ${trigger.getAttribute("aria-label") || ""} ${trigger.getAttribute("title") || ""}`
    ).toLowerCase();
    let score = 0;

    if (kind === "sort") {
      if (text.includes("sort")) {
        score += 16;
      }
      if (text.includes("recent")) {
        score += 8;
      }
      if (text.includes("star")) {
        score += 4;
      }
    } else {
      if (text.includes("type")) {
        score += 16;
      }
      if (text.includes("filter")) {
        score += 12;
      }
      if (text.includes("repositories") || text.includes("topics") || text.includes("all")) {
        score += 4;
      }
    }

    if (scopeRoot?.contains(trigger)) {
      score += 4;
    }
    if (trigger.closest("action-menu, details")) {
      score += 2;
    }

    return score;
  }

  function findStarsMenuTrigger(kind) {
    const mount = findTopControlsMount();
    const scopes = [mount.container, document].filter(Boolean);
    const selectors = kind === "sort"
      ? "#stars-sort-menu-button, button[id*='sort-menu-button'], button[aria-haspopup='menu'], button[aria-haspopup='true'], details summary"
      : "#stars-type-menu-button, #stars-filter-menu-button, button[id*='type-menu-button'], button[id*='filter-menu-button'], button[aria-haspopup='menu'], button[aria-haspopup='true'], details summary";
    const seen = new Set();
    let bestTrigger = null;
    let bestScore = -1;

    for (const scope of scopes) {
      for (const candidate of scope.querySelectorAll(selectors)) {
        if (seen.has(candidate)) {
          continue;
        }
        seen.add(candidate);

        const score = scoreStarsMenuTrigger(candidate, kind, scope);
        if (score > bestScore) {
          bestScore = score;
          bestTrigger = candidate;
        }
      }
    }

    return bestScore >= (kind === "sort" ? 10 : 8) ? bestTrigger : null;
  }

  function unwrapMenuRoot(container) {
    if (!container) {
      return null;
    }
    if (container.matches("ul[role='menu'], ul[role='listbox'], [role='menu'], [role='listbox']")) {
      return container;
    }
    return container.querySelector("ul[role='menu'], ul[role='listbox'], [role='menu'], [role='listbox'], details-menu");
  }

  function getMenuRootFromTrigger(trigger) {
    const controlledIds = [trigger?.getAttribute("aria-controls"), trigger?.getAttribute("popovertarget")].filter(Boolean);

    for (const id of controlledIds) {
      const root = unwrapMenuRoot(document.getElementById(id));
      if (root) {
        return root;
      }
    }

    const actionMenuRoot = unwrapMenuRoot(trigger?.closest("action-menu"));
    if (actionMenuRoot) {
      return actionMenuRoot;
    }

    const detailsRoot = unwrapMenuRoot(trigger?.closest("details[open]"));
    if (detailsRoot) {
      return detailsRoot;
    }

    return null;
  }

  function findInteractiveMenuElement(item) {
    if (!item) {
      return null;
    }
    if (item.matches("button, a, [role='menuitemradio'], [role='menuitemcheckbox'], [role='option']")) {
      return item;
    }
    return item.querySelector("button, a, [role='menuitemradio'], [role='menuitemcheckbox'], [role='option']");
  }

  function findMenuTemplateItem(menuRoot) {
    const directChildren = [...menuRoot.children].filter((child) => {
      if (!normalizeText(child.textContent)) {
        return false;
      }
      return child.matches("li, button, a, [role='menuitemradio'], [role='menuitemcheckbox'], [role='option']");
    });
    if (directChildren.length > 0) {
      return directChildren[0];
    }

    const listItem = [...menuRoot.querySelectorAll("li")].find((item) => Boolean(findInteractiveMenuElement(item)) && normalizeText(item.textContent));
    if (listItem) {
      return listItem;
    }

    return [...menuRoot.querySelectorAll("button, a")].find((item) => normalizeText(item.textContent)) || null;
  }

  function stripMenuCloneAttributes(root) {
    const targets = [root, ...root.querySelectorAll("*")];
    const removableAttributes = [
      "id",
      "href",
      "data-hydro-click",
      "data-hydro-click-hmac",
      "data-ga-click",
      "data-hotkey",
      "data-selected-links",
      "aria-current",
      "aria-describedby"
    ];

    for (const node of targets) {
      for (const attribute of removableAttributes) {
        node.removeAttribute(attribute);
      }
    }
  }

  function setMenuItemLabel(root, label) {
    const labelNode = root.querySelector(".ActionListItem-label, .SelectMenu-item-text, .Truncate-text")
      || [...root.querySelectorAll("span, div")].find((element) => normalizeText(element.textContent) && !element.querySelector("svg"));

    if (labelNode) {
      labelNode.textContent = label;
      return;
    }

    const interactive = findInteractiveMenuElement(root) || root;
    interactive.textContent = label;
  }

  function setMenuItemSelected(root, selected) {
    const interactive = findInteractiveMenuElement(root) || root;
    interactive.setAttribute("aria-checked", String(selected));
    interactive.setAttribute("aria-selected", String(selected));

    for (const element of root.querySelectorAll(".ActionListItem-singleSelectCheckmark, .octicon-check")) {
      element.hidden = !selected;
      element.setAttribute("aria-hidden", String(!selected));
    }
  }

  function closeMenuFromTrigger(trigger) {
    const popoverId = trigger?.getAttribute("popovertarget");
    const popover = popoverId ? document.getElementById(popoverId) : null;
    if (popover && typeof popover.hidePopover === "function") {
      popover.hidePopover();
      return;
    }

    const details = trigger?.closest("details[open]");
    if (details) {
      details.removeAttribute("open");
      return;
    }

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  }

  function createInjectedMenuItem(templateItem, menuKind, optionKey, label, selected, onSelect) {
    const root = templateItem.cloneNode(true);
    stripMenuCloneAttributes(root);
    root.dataset.githubStarListsPlusMenuKind = menuKind;
    root.dataset.githubStarListsPlusMenuOption = optionKey;
    setMenuItemLabel(root, label);
    setMenuItemSelected(root, selected);

    const interactive = findInteractiveMenuElement(root) || root;
    if (interactive.tagName === "BUTTON") {
      interactive.type = "button";
    }
    if (interactive.tagName === "A") {
      interactive.setAttribute("href", "#");
    }
    interactive.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await onSelect();
    });

    return root;
  }

  async function applyStarsViewState() {
    if (state.view.sort !== "default") {
      await ensureStarDatesReady();
    }

    state.view.filterDirty = state.view.filter !== getDefaultStarsFilter();
    syncStarsViewToUrl();
    syncPaginationLinks();
    syncStarsSortTriggerLabel();
    const filterButton = document.querySelector("[data-github-star-lists-plus-view-kind='filter']");
    if (filterButton) {
      syncStarsFilterButton(filterButton);
    }
    applyCardFilters();
  }

  function injectStarsMenuOptions(kind, attempt = 0) {
    if (kind === "filter" && currentListIdentity()) {
      return;
    }

    const trigger = findStarsMenuTrigger(kind);
    if (!trigger) {
      return;
    }

    const menuRoot = getMenuRootFromTrigger(trigger);
    if (!menuRoot) {
      if (attempt < 2) {
        globalThis.setTimeout(() => injectStarsMenuOptions(kind, attempt + 1), 80);
      }
      return;
    }

    const templateItem = findMenuTemplateItem(menuRoot);
    const insertParent = templateItem?.parentElement || menuRoot;
    if (!templateItem || !insertParent) {
      if (attempt < 2) {
        globalThis.setTimeout(() => injectStarsMenuOptions(kind, attempt + 1), 80);
      }
      return;
    }

    for (const node of menuRoot.querySelectorAll(`[data-github-star-lists-plus-menu-kind='${kind}']`)) {
      node.remove();
    }

    const definitions = kind === "sort"
      ? [
          { key: "star-desc", label: "Star newest" },
          { key: "star-asc", label: "Star oldest" }
        ]
      : [
          { key: "all", label: "All groups" },
          { key: "ungrouped", label: "Ungrouped" }
        ];

    for (const definition of definitions) {
      const item = createInjectedMenuItem(
        templateItem,
        kind,
        definition.key,
        definition.label,
        kind === "sort" ? state.view.sort === definition.key : state.view.filter === definition.key,
        async () => {
          if (kind === "sort") {
            state.view.sort = definition.key;
          } else {
            state.view.filter = definition.key;
          }

          await applyStarsViewState();
          closeMenuFromTrigger(trigger);
        }
      );
      insertParent.appendChild(item);
    }
  }

  function bindStarsMenuTrigger(kind) {
    const trigger = findStarsMenuTrigger(kind);
    if (!trigger || trigger.dataset.githubStarListsPlusBound === kind) {
      return;
    }

    const scheduleSync = () => {
      globalThis.requestAnimationFrame(() => {
        globalThis.setTimeout(() => injectStarsMenuOptions(kind), 0);
      });
    };

    trigger.dataset.githubStarListsPlusBound = kind;
    trigger.addEventListener("click", scheduleSync);
    trigger.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        scheduleSync();
      }
    });
  }

  function ensureStarsViewMenus() {
    bindStarsMenuTrigger("sort");
    ensureStarsFilterButton();
    syncStarsSortTriggerLabel();
    syncPaginationLinks();
  }

  function findRepositoryDateHost() {
    return document.querySelector(".github-star-lists-plus-repo-date");
  }

  function clearRepositoryDateHosts() {
    for (const host of document.querySelectorAll(".github-star-lists-plus-repo-date")) {
      host.remove();
    }
  }

  function findRepositoryDateAnchor(slot, control) {
    const directCandidates = [control.container, control.form, control.button].filter(Boolean);

    for (const candidate of directCandidates) {
      if (candidate.parentElement === slot) {
        return candidate;
      }

      if (!slot.contains(candidate)) {
        continue;
      }

      let cursor = candidate;
      while (cursor && cursor.parentElement !== slot) {
        cursor = cursor.parentElement;
      }
      if (cursor) {
        return cursor;
      }
    }

    return null;
  }

  function resolveRepositoryDateMount(control) {
    const slot = control.button?.closest("li")
      || control.form?.closest("li")
      || control.container?.closest("li")
      || control.container
      || control.form?.parentElement
      || control.button?.parentElement
      || null;

    if (!slot) {
      return null;
    }

    return {
      slot,
      anchor: findRepositoryDateAnchor(slot, control)
    };
  }

  function ensureRepositoryDateHost(control) {
    const mount = resolveRepositoryDateMount(control);
    if (!mount?.slot) {
      return null;
    }

    let host = [...mount.slot.children].find((element) => element.classList?.contains("github-star-lists-plus-repo-date")) || null;
    if (!host) {
      host = document.createElement("div");
      host.className = "github-star-lists-plus-repo-date";
      if (mount.anchor?.parentElement === mount.slot) {
        mount.slot.insertBefore(host, mount.anchor.nextSibling);
      } else {
        mount.slot.appendChild(host);
      }
    }

    return host;
  }

  function resolveRepositoryDateContainer(form, button, fallbackElement) {
    const candidates = [
      button?.closest(".BtnGroup-parent"),
      form?.closest(".BtnGroup-parent"),
      button?.closest("li"),
      form?.closest("li"),
      button?.closest(".js-social-container"),
      form?.closest(".js-social-container"),
      button?.closest("[data-testid='repository-actions']"),
      form?.closest("[data-testid='repository-actions']"),
      button?.parentElement,
      form?.parentElement,
      fallbackElement?.closest?.("li, div, span") || null,
      fallbackElement
    ].filter(Boolean);

    return candidates[0] || null;
  }

  function scoreRepositoryStarControl(candidate, repoNwo) {
    const repoPath = `/${String(repoNwo || "").toLowerCase()}/`;
    const formAction = String(candidate.form?.action || "").toLowerCase();
    const ariaLabel = normalizeText(candidate.button?.getAttribute("aria-label") || "").toLowerCase();
    const buttonText = normalizeText(candidate.button?.textContent || "").toLowerCase();

    let score = 0;
    if (formAction.includes(repoPath)) {
      score += 28;
    }
    if (candidate.form) {
      score += 6;
    }
    if (/star this repository|unstar this repository/.test(ariaLabel)) {
      score += 12;
    }
    if (/star a repository/.test(ariaLabel)) {
      score += 6;
    }
    if (/\bstar\b|\bstarred\b|\bunstar\b/.test(buttonText)) {
      score += 8;
    }
    if (candidate.button?.closest(".gh-header-actions, .Layout-sidebar, .js-social-container, [data-testid='repository-actions']")) {
      score += 10;
    }
    if (candidate.container?.matches?.(".BtnGroup-parent, .js-social-container, li")) {
      score += 4;
    }

    return score;
  }

  function closeBatchListPanel() {
    document.querySelector(".github-star-lists-plus-batch-panel")?.remove();

    if (typeof state.batchPanelCleanup === "function") {
      state.batchPanelCleanup();
      state.batchPanelCleanup = null;
    }

    const toolbar = document.querySelector(".github-star-lists-plus-batch-toolbar");
    if (!toolbar) {
      return;
    }

    toolbar.classList.remove("has-panel");
    delete toolbar.dataset.batchMode;
    for (const button of toolbar.querySelectorAll("button[data-action='add-lists'], button[data-action='remove-lists']")) {
      button.dataset.active = "false";
    }
  }

  function buildListEntry(action, fallbackItem) {
    const listId = action?.id || fallbackItem?.id || "";
    return {
      id: listId,
      name: action?.name || fallbackItem?.name || listId,
      url: action?.url || fallbackItem?.url || `https://github.com/stars?list=${encodeURIComponent(listId)}`
    };
  }

  function countSelectedReposInList(listId) {
    let count = 0;

    for (const repoKey of state.selectedKeys) {
      const items = state.repoCache?.[repoKey]?.lists || [];
      if (items.some((item) => item.id === listId)) {
        count += 1;
      }
    }

    return count;
  }

  async function applyBatchListChanges(repoKeys, listIds, mode) {
    const targetChecked = mode === "add";
    const listCatalogMap = new Map((state.listCatalog || []).map((item) => [item.id, item]));
    const patch = {};
    const succeededKeys = [];
    const failedKeys = [];
    const updatedAt = Date.now();

    for (const repoKey of repoKeys) {
      const card = findCardByKey(repoKey);
      if (!card) {
        failedKeys.push(repoKey);
        continue;
      }

      const actions = await discoverListActions(card.root);
      if (actions.length === 0) {
        failedKeys.push(repoKey);
        continue;
      }

      const actionMap = new Map(actions.map((action) => [action.id, action]));
      let nextLists = Array.isArray(state.repoCache?.[repoKey]?.lists)
        ? state.repoCache[repoKey].lists.map((item) => ({ ...item }))
        : [];
      let repoFailed = false;

      for (const listId of listIds) {
        const action = actionMap.get(listId);
        const fallbackItem = listCatalogMap.get(listId);
        const hadList = nextLists.some((item) => item.id === listId);

        if (!action) {
          const alreadyMatches = targetChecked ? hadList : !hadList;
          if (!alreadyMatches) {
            repoFailed = true;
          }
          continue;
        }

        if (action.checked !== targetChecked) {
          try {
            await submitToggleAction(action);
          } catch (_error) {
            repoFailed = true;
            continue;
          }
        }

        if (targetChecked) {
          nextLists = dedupeBy([...nextLists, buildListEntry(action, fallbackItem)], (item) => item.id);
        } else {
          nextLists = nextLists.filter((item) => item.id !== listId);
        }
      }

      patch[repoKey] = {
        ...(state.repoCache?.[repoKey] || {}),
        lists: nextLists,
        listCheckedAt: updatedAt
      };

      if (repoFailed) {
        failedKeys.push(repoKey);
      } else {
        succeededKeys.push(repoKey);
      }
    }

    if (Object.keys(patch).length > 0) {
      await storage.mergeRepoCache(patch);
      state.repoCache = {
        ...(state.repoCache || {}),
        ...patch
      };

      for (const repoKey of Object.keys(patch)) {
        const card = findCardByKey(repoKey);
        if (card) {
          renderCardMeta(card, state.repoCache[repoKey] || {});
        }
      }

      applyCardFilters();
    }

    return {
      succeededKeys,
      failedKeys
    };
  }

  function openBatchListPanel(mode) {
    const toolbar = ensureBatchToolbar();
    if (state.selectedKeys.size === 0) {
      return;
    }

    if (!Array.isArray(state.listCatalog) || state.listCatalog.length === 0) {
      return;
    }

    if (toolbar.dataset.batchMode === mode) {
      closeBatchListPanel();
      return;
    }

    closeBatchListPanel();

    const panel = document.createElement("div");

    function readSelectedRepoKeys() {
      return [...state.selectedKeys];
    }
    panel.className = "github-star-lists-plus-batch-panel";
    panel.innerHTML = `
      <div class="github-star-lists-plus-repo-panel-head">
        <strong>${mode === "add" ? "Add to lists" : "Remove from lists"}</strong>
        <button class="Button Button--secondary Button--small" type="button" data-action="close"><span class="Button-content"><span class="Button-label">Close</span></span></button>
      </div>
      <input type="search" class="github-star-lists-plus-batch-search" placeholder="Search list name">
      <div class="github-star-lists-plus-repo-selected"></div>
      <div class="github-star-lists-plus-repo-options"></div>
      <div class="github-star-lists-plus-batch-note" aria-live="polite"></div>
      <div class="github-star-lists-plus-repo-actions">
        <button class="Button Button--secondary Button--small" type="button" data-action="apply"><span class="Button-content"><span class="Button-label">${mode === "add" ? "Add" : "Remove"} ${state.selectedKeys.size} repositories</span></span></button>
      </div>
    `;
    toolbar.appendChild(panel);
    toolbar.classList.add("has-panel");
    toolbar.dataset.batchMode = mode;

    const toggleButton = toolbar.querySelector(`button[data-action='${mode === "add" ? "add-lists" : "remove-lists"}']`);
    if (toggleButton) {
      toggleButton.dataset.active = "true";
    }

    const options = state.listCatalog.map((item) => ({
      ...item,
      checked: false,
      presentCount: countSelectedReposInList(item.id)
    }));
    const selectedHost = panel.querySelector(".github-star-lists-plus-repo-selected");
    const optionsHost = panel.querySelector(".github-star-lists-plus-repo-options");
    const searchInput = panel.querySelector(".github-star-lists-plus-batch-search");
    const note = panel.querySelector(".github-star-lists-plus-batch-note");
    const applyButton = panel.querySelector("button[data-action='apply']");

    function renderOptions() {
      for (const option of options) {
        option.presentCount = countSelectedReposInList(option.id);
      }

      const query = searchInput.value.trim().toLowerCase();
      const visibleOptions = options.filter((option) => option.name.toLowerCase().includes(query));
      optionsHost.innerHTML = visibleOptions.length > 0
        ? visibleOptions
            .map((option) => `
              <label class="github-star-lists-plus-repo-option ${option.checked ? "is-checked" : ""}">
                <input data-list-id="${escapeHtml(option.id)}" type="checkbox" ${option.checked ? "checked" : ""}>
                <span class="github-star-lists-plus-batch-copy">
                  <strong>${escapeHtml(option.name)}</strong>
                  <small>${option.presentCount}/${readSelectedRepoKeys().length} selected repositories ${mode === "add" ? "are already in this list" : "are in this list"}</small>
                </span>
              </label>
            `)
            .join("")
        : `<div class="github-star-lists-plus-batch-empty">No matching lists</div>`;

      selectedHost.innerHTML = options
        .filter((option) => option.checked)
        .map((option) => `<span class="github-star-lists-plus-badge">${escapeHtml(option.name)}</span>`)
        .join("") || `<span class="github-star-lists-plus-badge is-empty">No list selected</span>`;

      for (const option of optionsHost.querySelectorAll("input[type='checkbox']")) {
        option.addEventListener("change", () => {
          const item = options.find((entry) => entry.id === option.dataset.listId);
          if (!item) {
            return;
          }
          item.checked = option.checked;
          renderOptions();
        });
      }

      applyButton.disabled = state.selectedKeys.size === 0 || options.every((option) => !option.checked);
      applyButton.innerHTML = `<span class="Button-content"><span class="Button-label">${mode === "add" ? "Add" : "Remove"} ${state.selectedKeys.size} repositories</span></span>`;
    }

    searchInput.addEventListener("input", renderOptions);
    panel.querySelector("button[data-action='close']").addEventListener("click", closeBatchListPanel);
    renderOptions();

    applyButton.addEventListener("click", async () => {
      const selectedListIds = options.filter((option) => option.checked).map((option) => option.id);
      if (selectedListIds.length === 0) {
        return;
      }

      applyButton.disabled = true;
      applyButton.innerHTML = `<span class="Button-content"><span class="Button-label">${mode === "add" ? "Adding..." : "Removing..."}</span></span>`;
      note.textContent = "";
      delete note.dataset.tone;

      try {
        const result = await applyBatchListChanges(readSelectedRepoKeys(), selectedListIds, mode);
        if (result.succeededKeys.length > 0) {
          setSelectionForKeys(result.succeededKeys, false);
        }

        syncBatchToolbar();

        if (result.failedKeys.length > 0) {
          note.dataset.tone = "error";
          note.textContent = `${result.succeededKeys.length} repositories updated. ${result.failedKeys.length} repositories need another try.`;
          applyButton.disabled = false;
          applyButton.innerHTML = `<span class="Button-content"><span class="Button-label">${mode === "add" ? "Add" : "Remove"} ${state.selectedKeys.size} repositories</span></span>`;
          renderOptions();
          return;
        }

        closeBatchListPanel();
      } catch (error) {
        note.dataset.tone = "error";
        note.textContent = error.message || String(error);
        applyButton.disabled = false;
        applyButton.innerHTML = `<span class="Button-content"><span class="Button-label">${mode === "add" ? "Add" : "Remove"} ${state.selectedKeys.size} repositories</span></span>`;
      }
    });

    const clickAway = (event) => {
      if (!toolbar.contains(event.target)) {
        closeBatchListPanel();
      }
    };

    document.addEventListener("mousedown", clickAway, true);
    state.batchPanelCleanup = () => {
      document.removeEventListener("mousedown", clickAway, true);
    };
  }

  function ensureBatchToolbar() {
    let toolbar = document.querySelector(".github-star-lists-plus-batch-toolbar");
    if (toolbar) {
      return toolbar;
    }

    toolbar = document.createElement("div");
    toolbar.className = "github-star-lists-plus-batch-toolbar";
    toolbar.innerHTML = `
      <span data-role="count">0 selected</span>
      <button class="Button Button--secondary Button--small" data-action="add-lists" type="button"><span class="Button-content"><span class="Button-label">Add to lists</span></span></button>
      <button class="Button Button--secondary Button--small" data-action="remove-lists" type="button"><span class="Button-content"><span class="Button-label">Remove from lists</span></span></button>
      <button class="Button Button--secondary Button--small" data-action="unstar" type="button"><span class="Button-content"><span class="Button-label">Bulk Unstar</span></span></button>
      <button class="Button Button--secondary Button--small" data-action="clear" type="button"><span class="Button-content"><span class="Button-label">Clear Selection</span></span></button>
    `;
    document.body.appendChild(toolbar);

    toolbar.querySelector("button[data-action='clear']").addEventListener("click", () => {
      closeBatchListPanel();
      state.selectedKeys.clear();
      for (const card of state.cards) {
        updateCardSelection(card);
      }
      syncBatchToolbar();
    });

    toolbar.querySelector("button[data-action='add-lists']").addEventListener("click", () => {
      openBatchListPanel("add");
    });

    toolbar.querySelector("button[data-action='remove-lists']").addEventListener("click", () => {
      openBatchListPanel("remove");
    });

    toolbar.querySelector("button[data-action='unstar']").addEventListener("click", async () => {
      const repoKeys = [...state.selectedKeys];
      if (repoKeys.length === 0) {
        return;
      }

      closeBatchListPanel();
      const actionButton = toolbar.querySelector("button[data-action='unstar']");
      actionButton.disabled = true;
      actionButton.innerHTML = `<span class="Button-content"><span class="Button-label">Processing...</span></span>`;

      try {
        const response = await sendRuntimeMessage({
          type: core.MESSAGE_TYPES.bulkUnstar,
          repoKeys
        });

        if (!response?.ok || response?.data?.failures?.length) {
          throw new Error("Some unstars failed, check PAT or login status");
        }

        for (const repoKey of repoKeys) {
          const card = findCardByKey(repoKey);
          card?.root?.remove();
        }
        state.cards = state.cards.filter((card) => !repoKeys.includes(card.key));
        state.selectedKeys.clear();
        syncBatchToolbar();
      } catch (error) {
        console.error("GitHub StarLists++ bulk unstar failed", error);
      } finally {
        actionButton.disabled = false;
        actionButton.innerHTML = `<span class="Button-content"><span class="Button-label">Bulk Unstar</span></span>`;
      }
    });

    return toolbar;
  }

  function watchStarsMutations() {
    const main = document.querySelector("main");
    if (!main) {
      return;
    }

    const observer = new MutationObserver(core.debounce(() => {
      if (!isStarsPage()) {
        return;
      }

      const nextCards = collectStarCards();
      const missingViewControls = !currentListIdentity()
        && (!findStarsMenuTrigger("sort") || !document.querySelector("[data-github-star-lists-plus-view-kind='filter']"));
      if (nextCards.length === 0 || (nextCards.length === state.cards.length && !missingViewControls)) {
        return;
      }

      setupStarsPage().catch((error) => {
        console.error("GitHub StarLists++ stars rerender failed", error);
      });
    }, 160));

    observer.observe(main, {
      childList: true,
      subtree: true
    });

    state.pageObserver = observer;
  }

  async function setupStarsPage() {
    state.settings = await storage.getSettings();
    state.cards = collectStarCards();
    if (state.cards.length === 0) {
      watchStarsMutations();
      state.pageCleanup = () => {};
      return;
    }

    const listCatalog = await loadListCatalog();
    state.listCatalog = listCatalog;
    const routeView = readStarsViewFromUrl();
    state.view.sort = routeView.sort;
    state.view.filter = currentListIdentity()
      ? "all"
      : (routeView.hasCustomFilter ? routeView.filter : getDefaultStarsFilter());
    state.view.filterDirty = routeView.hasCustomFilter;
    const hasBatchTargets = Boolean(state.settings.enableBatchSelection) && state.cards.some((card) => Boolean(card.starForm));

    for (const [index, card] of state.cards.entries()) {
      if (hasBatchTargets) {
        ensureSelectionControl(card, index);
      }
      updateCardSelection(card);
    }

    ensureStarsViewMenus();
    if (hasBatchTargets) {
      ensureBatchToolbar();
    }

    state.repoCache = await hydrateRepoLists(state.cards, listCatalog);

    if (state.settings.showStarDate || state.view.sort !== "default") {
      await ensureStarDatesReady();
    }

    syncStarsViewToUrl();
    syncPaginationLinks();
    applyCardFilters();
    watchStarsMutations();
    syncBatchToolbar();
    state.pageCleanup = () => {
      document.querySelector(".github-star-lists-plus-batch-toolbar")?.remove();
    };
  }

  function pickVisibleStarControl(repoNwo) {
    const [owner, repo] = repoNwo.split("/");
    const selectors = [
      `form[action*='/${owner}/${repo}/star']`,
      `form[action*='/${owner}/${repo}/unstar']`,
      `a[aria-label*='star a repository' i]`,
      `a[aria-label*='unstar this repository' i]`,
      `button[aria-label*='star this repository' i]`,
      `button[aria-label*='unstar this repository' i]`,
      `[data-testid='star-button']`,
      `button[data-testid*='star' i]`,
      `[role='button'][data-testid*='star' i]`
    ];
    const seen = new Set();
    const candidates = [];

    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (seen.has(element) || !isVisible(element)) {
          continue;
        }
        seen.add(element);

        const form = element.closest("form") || (element.tagName === "FORM" ? element : null);
        const button = element.matches("button, input[type='submit'], [aria-label], [data-testid]") ? element : form?.querySelector("button, input[type='submit']");
        const container = resolveRepositoryDateContainer(form, button, element);
        candidates.push({
          form,
          button,
          container,
          score: 0
        });
      }
    }

    for (const candidate of candidates) {
      candidate.score = scoreRepositoryStarControl(candidate, repoNwo);
    }

    candidates.sort((left, right) => right.score - left.score);
    return candidates[0] || null;
  }

  function isRepositoryStarred(control) {
    const buttonText = normalizeText(control.button?.textContent || "");
    const ariaLabel = normalizeText(control.button?.getAttribute("aria-label") || "");
    return control.form?.action?.includes("/unstar")
      || control.button?.getAttribute("aria-pressed") === "true"
      || /starred/i.test(buttonText)
      || /\bunstar\b/i.test(ariaLabel);
  }

  async function lookupRepositoryStarDate(repoKey) {
    const cacheEntries = await storage.getRepoCacheEntries([repoKey]);
    let starredAt = cacheEntries[repoKey]?.starredAt || "";

    if (!starredAt) {
      try {
        const response = await sendRuntimeMessage({
          type: core.MESSAGE_TYPES.getStarMetadata,
          repoKeys: [repoKey],
          pageHint: 1,
          username: getTargetStarsUser()
        });
        starredAt = response?.data?.[repoKey] || "";
        if (starredAt) {
          await storage.mergeRepoCache({
            [repoKey]: { ...(cacheEntries[repoKey] || {}), starredAt, starCheckedAt: Date.now() }
          });
        }
      } catch (_error) {}
    }

    if (!starredAt) {
      starredAt = await fetchStarDateFromStarsSearch(repoKey, getTargetStarsUser());
      if (starredAt) {
        await storage.mergeRepoCache({
          [repoKey]: { ...(cacheEntries[repoKey] || {}), starredAt, starCheckedAt: Date.now() }
        });
      }
    }

    return starredAt;
  }

  function renderRepositoryStarDate(control, starredAt, lookupStatus) {
    const dateBadge = ensureRepositoryDateHost(control);
    if (!dateBadge) {
      return null;
    }

    dateBadge.textContent = starredAt ? core.formatStarDate(starredAt) : "";
    dateBadge.dataset.starState = isRepositoryStarred(control) ? "starred" : "unstarred";
    dateBadge.dataset.lookupStatus = lookupStatus;
    return dateBadge;
  }

  function renderRepositoryChips(wrapper, repoCacheEntry) {
    let chips = wrapper.querySelector(".github-star-lists-plus-repo-chips");
    if (!chips) {
      chips = document.createElement("div");
      chips.className = "github-star-lists-plus-repo-chips";
      wrapper.appendChild(chips);
    }

    const items = repoCacheEntry?.lists || [];
    chips.innerHTML = items.length > 0
      ? items
          .map((item) => `<a class="github-star-lists-plus-badge" href="${escapeHtml(item.url)}">${escapeHtml(item.name)}</a>`)
          .join("")
      : `<span class="github-star-lists-plus-badge is-empty">Ungrouped</span>`;
  }



  function serializeFormFields(form) {
    const payload = [];
    const fieldList = [...form.querySelectorAll("input[name], textarea[name], select[name]")];
    for (const field of fieldList) {
      if ((field.type === "checkbox" || field.type === "radio") && !field.checked) {
        continue;
      }
      payload.push([field.name, field.value]);
    }

    const submitButton = form.querySelector("button[name], input[type='submit'][name]");
    if (submitButton?.name) {
      payload.push([submitButton.name, submitButton.value || ""]);
    }

    return payload;
  }

  function extractActionName(container) {
    const text = container?.textContent?.replace(/\s+/g, " ").trim() || "";
    return text.replace(/selected/gi, "").trim();
  }

  function detectCheckedState(container, form) {
    if (container?.getAttribute("aria-checked") === "true") {
      return true;
    }
    if (form.querySelector("input[type='checkbox']:checked")) {
      return true;
    }
    return Boolean(container?.querySelector("svg.octicon-check, .octicon-check"));
  }

  function normalizeActionId(name) {
    return String(name || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-");
  }

  function extractListActionsFromPanel(panel) {
    const forms = [...panel.querySelectorAll("form")];
    const actions = [];

    for (const form of forms) {
      const row = form.closest("label, li, [role='menuitemcheckbox'], div, button") || form;
      const name = extractActionName(row);
      if (!name || /create list|lists?/i.test(name) && name.trim().toLowerCase() === "lists") {
        continue;
      }

      const actionUrl = form.action || form.getAttribute("action") || "";
      if (!actionUrl) {
        continue;
      }

      actions.push({
        id: normalizeActionId(name),
        name,
        checked: detectCheckedState(row, form),
        method: (form.method || "post").toUpperCase(),
        actionUrl: new URL(actionUrl, location.origin).toString(),
        payload: serializeFormFields(form),
        url: `https://github.com/stars?list=${encodeURIComponent(normalizeActionId(name))}`
      });
    }

    return dedupeBy(actions, (item) => item.id);
  }

  function scoreNativeListTrigger(element, scopeRoot, excludedElements) {
    if (!element || excludedElements.has(element) || !isVisible(element)) {
      return -1;
    }

    const text = [
      element.textContent,
      element.getAttribute("aria-label"),
      element.getAttribute("title")
    ]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .toLowerCase();

    let score = 0;
    if (scopeRoot.contains(element)) {
      score += 4;
    }
    if (text.includes("list")) {
      score += 6;
    }
    if (element.closest("form") && scopeRoot.querySelector("form")?.contains(element.closest("form"))) {
      score += 3;
    }
    if (element.tagName === "SUMMARY") {
      score += 1;
    }

    return score;
  }

  function findNativeListTrigger(scopeRoot) {
    const manageButton = scopeRoot.querySelector(".github-star-lists-plus-repo-manage");
    const excludedElements = new Set([manageButton].filter(Boolean));

    // Direct match for GitHub's current lists dropdown trigger
    const directMatch = scopeRoot.querySelector("summary[aria-label*='list' i], summary[aria-label*='List' i]")
      || scopeRoot.closest("li, article, div")?.querySelector("summary[aria-label*='list' i], summary[aria-label*='List' i]");
    if (directMatch && !excludedElements.has(directMatch) && isVisible(directMatch)) {
      return directMatch;
    }

    // Fallback: scored search
    const scopes = [
      scopeRoot,
      scopeRoot.querySelector("form"),
      scopeRoot.parentElement,
      scopeRoot.parentElement?.parentElement,
      scopeRoot.closest("li, article, section, div, form"),
      document
    ].filter(Boolean);

    let bestTrigger = null;
    let bestScore = -1;
    const seen = new Set();

    for (const scope of scopes) {
      const candidates = [
        ...scope.querySelectorAll("summary, button[aria-haspopup='menu'], button[aria-haspopup='true'], details summary")
      ];

      for (const candidate of candidates) {
        if (seen.has(candidate)) {
          continue;
        }
        seen.add(candidate);

        const score = scoreNativeListTrigger(candidate, scopeRoot, excludedElements);
        if (score > bestScore) {
          bestScore = score;
          bestTrigger = candidate;
        }
      }

      if (bestScore >= 8) {
        break;
      }
    }

    return bestScore >= 0 ? bestTrigger : null;
  }

  function findOpenNativePanel(trigger) {
    const popovers = [
      ...document.querySelectorAll("details[open] details-menu, [popover]:not([hidden]), [role='dialog'], [role='menu']")
    ].filter((element) => isVisible(element) && element.textContent.toLowerCase().includes("list"));

    if (popovers.length > 0) {
      return popovers[0];
    }

    const details = trigger?.closest("details[open]");
    if (details) {
      return details.querySelector("details-menu, [role='menu'], [role='dialog']");
    }

    return null;
  }

  async function discoverListActions(scopeRoot) {
    const trigger = findNativeListTrigger(scopeRoot);
    if (!trigger) {
      return [];
    }

    trigger.click();
    await core.wait(320);

    const panel = findOpenNativePanel(trigger);
    if (!panel) {
      return [];
    }

    const actions = extractListActionsFromPanel(panel);

    const ownerDocument = trigger.ownerDocument;
    ownerDocument.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return actions;
  }

  async function submitToggleAction(action) {
    const body = new URLSearchParams();
    for (const [name, value] of action.payload) {
      body.append(name, value);
    }

    const response = await fetch(action.actionUrl, {
      method: action.method,
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
      },
      body: body.toString()
    });

    if (!response.ok) {
      throw new Error(`List update failed: ${response.status}`);
    }
  }

  async function fetchStarDateFromStarsSearch(repoKey, username) {
    if (!repoKey || !username) {
      return "";
    }

    const { repo } = core.splitRepoKey(repoKey);
    const searchTerms = dedupeBy([repoKey, repo].filter(Boolean), (value) => String(value).toLowerCase());

    for (const searchTerm of searchTerms) {
      const url = buildStarsRepositoriesUrl(username, {
        query: searchTerm
      });
      if (!url) {
        continue;
      }

      let response;
      try {
        response = await fetch(url, {
          credentials: "include"
        });
      } catch (_error) {
        continue;
      }

      if (!response.ok) {
        continue;
      }

      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      const matchedDates = extractStarDateMapFromDocument(doc, [repoKey]);
      if (matchedDates[repoKey]) {
        return matchedDates[repoKey];
      }
    }

    return "";
  }

  function watchRepositoryMutations(repoNwo) {
    if (state.pageObserver) {
      return;
    }

    const main = document.querySelector("main");
    if (!main) {
      return;
    }

    const observer = new MutationObserver(core.debounce(() => {
      if (!isRepositoryPage() || core.readRepositoryNwo() !== repoNwo) {
        return;
      }

      const control = pickVisibleStarControl(repoNwo);
      const dateBadge = findRepositoryDateHost();
      const nextStarState = control && isRepositoryStarred(control) ? "starred" : "unstarred";
      const lookupStatus = dateBadge?.dataset.lookupStatus || "";

      if (!control?.container || !dateBadge || dateBadge.dataset.starState !== nextStarState || (nextStarState === "starred" && lookupStatus !== "ready")) {
        setupRepositoryPage().catch((error) => {
          console.error("GitHub StarLists++ repository rerender failed", error);
        });
      }
    }, 180));

    observer.observe(main, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-label", "aria-pressed", "class", "open"]
    });

    state.pageObserver = observer;
  }

  async function setupRepositoryPage() {
    state.settings = await storage.getSettings();
    const repoNwo = core.readRepositoryNwo();
    if (!repoNwo) return;

    watchRepositoryMutations(repoNwo);
    const control = pickVisibleStarControl(repoNwo);
    if (!control?.container) {
      state.pageCleanup = () => {
        clearRepositoryDateHosts();
      };
      return;
    }

    clearRepositoryDateHosts();
    let dateBadge = renderRepositoryStarDate(control, "", "idle");

    const starred = isRepositoryStarred(control);
    if (starred) {
      const repoKey = repoNwo.toLowerCase();
      const starredAt = await lookupRepositoryStarDate(repoKey);

      if (starredAt) {
        dateBadge = renderRepositoryStarDate(control, starredAt, "ready");
      } else {
        dateBadge = renderRepositoryStarDate(control, "", "empty");
      }
    } else {
      dateBadge = renderRepositoryStarDate(control, "", "idle");
    }

    state.pageCleanup = () => {
      dateBadge?.remove();
      clearRepositoryDateHosts();
    };
  }

  function watchGenericListMutations() {
    if (state.pageObserver) {
      return;
    }

    const main = document.querySelector("main");
    if (!main) {
      return;
    }

    const observer = new MutationObserver(core.debounce(() => {
      if (!isGenericRepoListPage()) {
        return;
      }

      setupGenericListPage().catch((error) => {
        console.error("GitHub StarLists++ generic list rerender failed", error);
      });
    }, 200));

    observer.observe(main, {
      childList: true,
      subtree: true
    });

    state.pageObserver = observer;
  }

  async function setupGenericListPage() {
    state.settings = await storage.getSettings();
    if (!state.settings?.showStarDate) {
      watchGenericListMutations();
      state.pageCleanup = () => {};
      return;
    }

    state.cards = collectStarCards();
    const starredCards = state.cards.filter((card) => {
      const form = card.starForm;
      return form?.action?.includes("/unstar");
    });

    if (starredCards.length === 0) {
      watchGenericListMutations();
      state.pageCleanup = () => {};
      return;
    }

    await hydrateStarDates(starredCards);
    state.repoCache = await storage.getRepoCacheEntries(starredCards.map((card) => card.key));

    for (const card of starredCards) {
      const cacheEntry = state.repoCache?.[card.key] || {};
      renderCardStarDate(card, cacheEntry);
    }

    watchGenericListMutations();
    state.pageCleanup = () => {};
  }

  function bootstrapContentScript() {
    if (state.bootstrapped) {
      return;
    }

    state.bootstrapped = true;
    watchRouteChanges();
    refreshRoute().catch((error) => {
      console.error("GitHub StarLists++ bootstrap failed", error);
    });
  }

  if (document.readyState === "loading") {
    const handleReady = () => {
      if (document.readyState === "loading") {
        return;
      }

      document.removeEventListener("readystatechange", handleReady);
      bootstrapContentScript();
    };

    document.addEventListener("readystatechange", handleReady);
  } else {
    bootstrapContentScript();
  }
})();
