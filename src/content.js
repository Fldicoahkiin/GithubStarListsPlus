(() => {
  const core = globalThis.GithubStarListsPlusCore;
  const storage = globalThis.GithubStarListsPlusStorage;

  const state = {
    lastUrl: "",
    routeTimer: 0,
    pageObserver: null,
    pageCleanup: null,
    repoPanelCleanup: null,
    cards: [],
    selectedKeys: new Set(),
    lastSelectedIndex: -1,
    view: {
      filter: "all",
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

  function isStarsPage() {
    return location.origin === "https://github.com" && (location.pathname === "/stars" || Boolean(currentListIdentity()));
  }

  function isRepositoryPage() {
    return Boolean(core.readRepositoryNwo()) && location.pathname !== "/stars";
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
    if (typeof state.pageCleanup === "function") {
      state.pageCleanup();
      state.pageCleanup = null;
    }

    if (state.pageObserver) {
      state.pageObserver.disconnect();
      state.pageObserver = null;
    }

    state.cards = [];
    state.selectedKeys.clear();
    state.lastSelectedIndex = -1;
  }

  function scheduleRouteRefresh() {
    clearTimeout(state.routeTimer);
    state.routeTimer = globalThis.setTimeout(() => {
      refreshRoute().catch((error) => {
        console.error("GithubStarListsPlus route refresh failed", error);
      });
    }, 120);
  }

  function watchRouteChanges() {
    const routeEvents = ["pjax:end", "turbo:load", "popstate"];
    for (const eventName of routeEvents) {
      document.addEventListener(eventName, scheduleRouteRefresh, true);
    }

    const observer = new MutationObserver(() => {
      if (location.href !== state.lastUrl) {
        scheduleRouteRefresh();
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
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
    }
  }

  function extractCardRoot(element) {
    return element?.closest("li, article, .Box-row, .col-12, [data-view-component='true']") || null;
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

  function collectStarCards() {
    const main = document.querySelector("main");
    if (!main) {
      return [];
    }

    const starForms = [...main.querySelectorAll("form[action*='/star'], form[action*='/unstar']")];
    const cards = [];
    const seenRoots = new Set();
    const seenKeys = new Set();

    for (const form of starForms) {
      const root = extractCardRoot(form);
      if (!root || seenRoots.has(root)) {
        continue;
      }

      const repoLink = findRepoLink(root);
      const repoInfo = repoLink ? core.parseRepositoryUrl(repoLink.href) : null;
      if (!repoInfo || seenKeys.has(repoInfo.key)) {
        continue;
      }

      seenRoots.add(root);
      seenKeys.add(repoInfo.key);
      cards.push({
        ...repoInfo,
        root,
        form,
        repoLink,
        description: extractCardDescription(root)
      });
    }

    return cards;
  }

  function ensureCardMeta(card) {
    let meta = card.root.querySelector(".github-star-lists-plus-card-meta");
    if (!meta) {
      meta = document.createElement("div");
      meta.className = "github-star-lists-plus-card-meta";
      card.root.appendChild(meta);
    }

    return meta;
  }

  function ensureSelectionControl(card, index) {
    if (!card.repoLink || !card.repoLink.parentElement) {
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
    wrapper.title = "选择仓库进行批量操作";

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

  function syncBatchToolbar() {
    const toolbar = document.querySelector(".github-star-lists-plus-batch-toolbar");
    if (!toolbar) {
      return;
    }

    const count = state.selectedKeys.size;
    toolbar.classList.toggle("is-visible", count > 0);
    toolbar.querySelector("[data-role='count']").textContent = `${count} 个已选`;
    toolbar.querySelector("button[data-action='unstar']").disabled = count === 0;
    toolbar.querySelector("button[data-action='clear']").disabled = count === 0;
  }

  function renderCardMeta(card, cacheEntry) {
    const meta = ensureCardMeta(card);
    const badges = Array.isArray(cacheEntry?.lists) ? cacheEntry.lists : [];
    const starDateText = core.formatStarDate(cacheEntry?.starredAt);
    const dateMarkup = cacheEntry?.starredAt
      ? `<span class="github-star-lists-plus-date">Starred on ${escapeHtml(starDateText)}</span>`
      : `<span class="github-star-lists-plus-date is-loading">正在读取 Star 日期...</span>`;

    const badgeMarkup = badges.length > 0
      ? badges
          .slice(0, 3)
          .map((item) => `<a class="github-star-lists-plus-badge" href="${escapeHtml(item.url)}">${escapeHtml(item.name)}</a>`)
          .join("")
      : `<span class="github-star-lists-plus-badge is-empty">未分组</span>`;

    const showDate = Boolean(state.settings?.showStarDate);
    const showBadges = Boolean(state.settings?.showListBadges);

    meta.innerHTML = [
      showDate ? dateMarkup : "",
      showBadges ? `<div class="github-star-lists-plus-badges">${badgeMarkup}</div>` : ""
    ].join("");
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
      if (!name || name.toLowerCase() === "lists") {
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
    const response = await sendRuntimeMessage({
      type: core.MESSAGE_TYPES.getStarMetadata,
      repoKeys,
      pageHint: Number(new URL(location.href).searchParams.get("page") || 1),
      username: core.readUserLogin()
    });

    if (!response?.ok || !response.data) {
      return;
    }

    const cachedEntries = await storage.getRepoCacheEntries(repoKeys);
    const patch = {};
    for (const card of cards) {
      const starredAt = response.data[card.key];
      if (!starredAt) {
        continue;
      }

      patch[card.key] = {
        ...(cachedEntries[card.key] || {}),
        starredAt,
        starCheckedAt: Date.now()
      };
    }

    if (Object.keys(patch).length > 0) {
      await storage.mergeRepoCache(patch);
    }
  }

  function extractSearchableText(card, cacheEntry) {
    const listNames = (cacheEntry?.lists || []).map((item) => item.name).join(" ");
    return `${card.owner} ${card.repo} ${card.description} ${listNames}`.toLowerCase();
  }

  function applyCardFilters() {
    const filterMode = state.view.filter;
    const searchValue = state.view.search.trim().toLowerCase();
    const currentList = currentListIdentity();
    const sortMode = state.view.sort;
    const cards = [...state.cards];

    for (const card of cards) {
      const cacheEntry = state.repoCache?.[card.key] || {};
      const listCount = Array.isArray(cacheEntry.lists) ? cacheEntry.lists.length : 0;
      const text = extractSearchableText(card, cacheEntry);
      const matchesSearch = !searchValue || text.includes(searchValue);
      let visible = matchesSearch;

      if (currentList) {
        visible = visible && (cacheEntry.lists || []).some((item) => item.id === currentList.id);
      } else if (filterMode === "ungrouped") {
        visible = visible && listCount === 0;
      } else if (filterMode === "all" && state.settings?.hideGroupedInAll) {
        visible = visible && listCount === 0;
      }

      card.root.classList.toggle("github-star-lists-plus-hidden", !visible);
    }

    if (sortMode !== "default") {
      const sortable = cards.filter((card) => !card.root.classList.contains("github-star-lists-plus-hidden"));
      sortable.sort((left, right) => {
        const leftValue = new Date(state.repoCache?.[left.key]?.starredAt || 0).getTime();
        const rightValue = new Date(state.repoCache?.[right.key]?.starredAt || 0).getTime();
        return sortMode === "star-asc" ? leftValue - rightValue : rightValue - leftValue;
      });

      const parent = sortable[0]?.root?.parentElement;
      if (parent) {
        for (const card of sortable) {
          parent.appendChild(card.root);
        }
      }
    }

    const note = document.querySelector(".github-star-lists-plus-toolbar-note");
    if (note) {
      note.textContent = currentList
        ? `当前是 list：${currentList.id}`
        : state.settings?.hideGroupedInAll && filterMode === "all"
          ? "“全部”视图当前仅显示未分组仓库"
          : "“全部”视图当前显示所有仓库";
    }
  }

  function syncToolbarSelection(listCatalog) {
    const filter = document.querySelector(".github-star-lists-plus-filter-select");
    if (!filter) {
      return;
    }

    filter.innerHTML = "";

    const allOption = document.createElement("option");
    allOption.value = "all";
    allOption.textContent = "全部";
    filter.appendChild(allOption);

    const ungroupedOption = document.createElement("option");
    ungroupedOption.value = "ungrouped";
    ungroupedOption.textContent = "未分组";
    filter.appendChild(ungroupedOption);

    for (const list of listCatalog) {
      const option = document.createElement("option");
      option.value = `list:${list.id}`;
      option.textContent = list.name;
      option.dataset.url = list.url;
      filter.appendChild(option);
    }

    const currentList = currentListIdentity();
    filter.value = currentList ? `list:${currentList.id}` : state.view.filter;
  }

  function ensureStarsToolbar(listCatalog) {
    let toolbar = document.querySelector(".github-star-lists-plus-toolbar");
    if (!toolbar) {
      toolbar = document.createElement("section");
      toolbar.className = "github-star-lists-plus-toolbar";
      toolbar.innerHTML = `
        <div class="github-star-lists-plus-toolbar-main">
          <label>
            <span>视图</span>
            <select class="github-star-lists-plus-filter-select"></select>
          </label>
          <label>
            <span>筛选</span>
            <input class="github-star-lists-plus-search-input" type="search" placeholder="搜索仓库、描述、list 名">
          </label>
          <label>
            <span>排序</span>
            <select class="github-star-lists-plus-sort-select">
              <option value="default">GitHub 默认</option>
              <option value="star-desc">按 Star 时间（新→旧）</option>
              <option value="star-asc">按 Star 时间（旧→新）</option>
            </select>
          </label>
        </div>
        <div class="github-star-lists-plus-toolbar-note"></div>
      `;

      const reference = state.cards[0]?.root?.parentElement || document.querySelector("main");
      reference?.parentElement?.insertBefore(toolbar, reference);

      toolbar.querySelector(".github-star-lists-plus-filter-select").addEventListener("change", (event) => {
        const value = event.target.value;
        if (value.startsWith("list:")) {
          const list = listCatalog.find((item) => `list:${item.id}` === value);
          if (list?.url) {
            location.assign(list.url);
          }
          return;
        }

        if (value === "all") {
          if (currentListIdentity()) {
            location.assign("https://github.com/stars");
            return;
          }
          state.view.filter = "all";
          applyCardFilters();
          return;
        }

        if (value === "ungrouped") {
          if (currentListIdentity()) {
            location.assign("https://github.com/stars");
            return;
          }
          state.view.filter = "ungrouped";
          applyCardFilters();
        }
      });

      toolbar.querySelector(".github-star-lists-plus-search-input").addEventListener("input", core.debounce((event) => {
        state.view.search = event.target.value;
        applyCardFilters();
      }, 100));

      toolbar.querySelector(".github-star-lists-plus-sort-select").addEventListener("change", (event) => {
        state.view.sort = event.target.value;
        applyCardFilters();
      });
    }

    syncToolbarSelection(listCatalog);
    return toolbar;
  }

  function ensureBatchToolbar() {
    let toolbar = document.querySelector(".github-star-lists-plus-batch-toolbar");
    if (toolbar) {
      return toolbar;
    }

    toolbar = document.createElement("div");
    toolbar.className = "github-star-lists-plus-batch-toolbar";
    toolbar.innerHTML = `
      <span data-role="count">0 个已选</span>
      <button data-action="unstar" type="button">批量取消 Star</button>
      <button data-action="clear" type="button">清空选择</button>
    `;
    document.body.appendChild(toolbar);

    toolbar.querySelector("button[data-action='clear']").addEventListener("click", () => {
      state.selectedKeys.clear();
      for (const card of state.cards) {
        updateCardSelection(card);
      }
      syncBatchToolbar();
    });

    toolbar.querySelector("button[data-action='unstar']").addEventListener("click", async () => {
      const repoKeys = [...state.selectedKeys];
      if (repoKeys.length === 0) {
        return;
      }

      const actionButton = toolbar.querySelector("button[data-action='unstar']");
      actionButton.disabled = true;
      actionButton.textContent = "处理中...";

      try {
        const response = await sendRuntimeMessage({
          type: core.MESSAGE_TYPES.bulkUnstar,
          repoKeys
        });

        if (!response?.ok || response?.data?.failures?.length) {
          throw new Error("部分仓库取消 Star 失败，请检查 PAT 或 GitHub 登录态");
        }

        for (const repoKey of repoKeys) {
          const card = state.cards.find((item) => item.key === repoKey);
          card?.root?.remove();
        }
        state.cards = state.cards.filter((card) => !repoKeys.includes(card.key));
        state.selectedKeys.clear();
        syncBatchToolbar();
      } catch (error) {
        console.error("GithubStarListsPlus bulk unstar failed", error);
      } finally {
        actionButton.disabled = false;
        actionButton.textContent = "批量取消 Star";
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
      if (nextCards.length === 0 || nextCards.length === state.cards.length) {
        return;
      }

      setupStarsPage().catch((error) => {
        console.error("GithubStarListsPlus stars rerender failed", error);
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
    state.view.filter = currentListIdentity() ? "all" : (state.view.filter || "all");

    for (const [index, card] of state.cards.entries()) {
      ensureCardMeta(card);
      if (state.settings.enableBatchSelection) {
        ensureSelectionControl(card, index);
      }
      updateCardSelection(card);
    }

    ensureStarsToolbar(listCatalog);
    if (state.settings.enableBatchSelection) {
      ensureBatchToolbar();
    }

    state.repoCache = await hydrateRepoLists(state.cards, listCatalog);
    applyCardFilters();

    if (state.settings.showStarDate) {
      await hydrateStarDates(state.cards);
      state.repoCache = await storage.getRepoCacheEntries(state.cards.map((card) => card.key));
      for (const card of state.cards) {
        renderCardMeta(card, state.repoCache[card.key] || {});
      }
      applyCardFilters();
    }

    watchStarsMutations();
    syncBatchToolbar();
    state.pageCleanup = () => {
      document.querySelector(".github-star-lists-plus-toolbar")?.remove();
      document.querySelector(".github-star-lists-plus-batch-toolbar")?.remove();
    };
  }

  function pickVisibleStarControl(repoNwo) {
    const [owner, repo] = repoNwo.split("/");
    const forms = [...document.querySelectorAll(`form[action$='/${owner}/${repo}/star'], form[action$='/${owner}/${repo}/unstar']`)];
    const visibleForms = forms.filter((form) => isVisible(form));
    const selectedForm = visibleForms[0] || forms[0];

    if (!selectedForm) {
      return null;
    }

    return {
      form: selectedForm,
      button: selectedForm.querySelector("button, input[type='submit']"),
      container: selectedForm.parentElement || selectedForm
    };
  }

  function isRepositoryStarred(control) {
    return control.form.action.includes("/unstar") || /starred/i.test(control.button?.textContent || "");
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
      : `<span class="github-star-lists-plus-badge is-empty">未分组</span>`;
  }

  async function saveRepositoryLists(repoKey, actions) {
    const repoCacheEntries = await storage.getRepoCacheEntries([repoKey]);
    const currentEntry = repoCacheEntries[repoKey] || {};
    const lists = actions
      .filter((action) => action.checked)
      .map((action) => ({
        id: action.id,
        name: action.name,
        url: action.url || `https://github.com/stars?list=${encodeURIComponent(action.id)}`
      }));

    const patch = {
      [repoKey]: {
        ...currentEntry,
        lists,
        listCheckedAt: Date.now()
      }
    };

    await storage.mergeRepoCache(patch);
    return patch[repoKey];
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

  function findNativeListTrigger(controlWrapper) {
    const manageButton = controlWrapper.querySelector(".github-star-lists-plus-repo-manage");
    const scopes = [
      controlWrapper.parentElement,
      controlWrapper.parentElement?.parentElement,
      controlWrapper.closest("section, div, form")?.parentElement,
      document
    ].filter(Boolean);

    for (const scope of scopes) {
      const candidates = [...scope.querySelectorAll("summary, button[aria-haspopup='menu'], button[aria-haspopup='true'], details summary")];
      const trigger = candidates.find((element) => element !== manageButton && isVisible(element));
      if (trigger) {
        return trigger;
      }
    }

    return null;
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

  async function discoverRepositoryActions(controlWrapper) {
    const trigger = findNativeListTrigger(controlWrapper);
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
      throw new Error(`list 更新失败: ${response.status}`);
    }
  }

  function closeRepositoryPanel() {
    document.querySelector(".github-star-lists-plus-repo-panel")?.remove();
    if (typeof state.repoPanelCleanup === "function") {
      state.repoPanelCleanup();
      state.repoPanelCleanup = null;
    }
  }

  async function openRepositoryPanel(wrapper, repoKey) {
    closeRepositoryPanel();

    const actions = await discoverRepositoryActions(wrapper);
    if (actions.length === 0) {
      const hint = document.createElement("div");
      hint.className = "github-star-lists-plus-repo-panel github-star-lists-plus-repo-panel-hint";
      hint.textContent = "暂时没读到 GitHub 原生 lists 菜单，先点开一次原生 Starred 下拉再试。";
      wrapper.appendChild(hint);
      globalThis.setTimeout(() => hint.remove(), 2400);
      return;
    }

    const panel = document.createElement("div");
    panel.className = "github-star-lists-plus-repo-panel";
    panel.innerHTML = `
      <div class="github-star-lists-plus-repo-panel-head">
        <strong>管理 lists</strong>
        <button type="button" data-action="close">关闭</button>
      </div>
      <input type="search" class="github-star-lists-plus-repo-search" placeholder="搜索 list 名">
      <div class="github-star-lists-plus-repo-selected"></div>
      <div class="github-star-lists-plus-repo-options"></div>
      <div class="github-star-lists-plus-repo-actions">
        <button type="button" data-action="save">保存</button>
      </div>
    `;
    wrapper.appendChild(panel);

    const optionsHost = panel.querySelector(".github-star-lists-plus-repo-options");
    const selectedHost = panel.querySelector(".github-star-lists-plus-repo-selected");
    const searchInput = panel.querySelector(".github-star-lists-plus-repo-search");
    const saveButton = panel.querySelector("button[data-action='save']");

    function renderOptions() {
      const query = searchInput.value.trim().toLowerCase();
      const visibleActions = actions.filter((action) => action.name.toLowerCase().includes(query));
      optionsHost.innerHTML = visibleActions
        .map((action) => `
          <label class="github-star-lists-plus-repo-option ${action.checked ? "is-checked" : ""}">
            <input data-list-id="${escapeHtml(action.id)}" type="checkbox" ${action.checked ? "checked" : ""}>
            <span>${escapeHtml(action.name)}</span>
          </label>
        `)
        .join("");

      selectedHost.innerHTML = actions
        .filter((action) => action.checked)
        .map((action) => `<span class="github-star-lists-plus-badge">${escapeHtml(action.name)}</span>`)
        .join("") || `<span class="github-star-lists-plus-badge is-empty">未选择任何 list</span>`;

      for (const option of optionsHost.querySelectorAll("input[type='checkbox']")) {
        option.addEventListener("change", () => {
          const action = actions.find((item) => item.id === option.dataset.listId);
          if (!action) {
            return;
          }
          action.checked = option.checked;
          renderOptions();
        });
      }
    }

    searchInput.addEventListener("input", renderOptions);
    panel.querySelector("button[data-action='close']").addEventListener("click", closeRepositoryPanel);
    renderOptions();

    saveButton.addEventListener("click", async () => {
      saveButton.disabled = true;
      saveButton.textContent = "保存中...";

      try {
        for (const action of actions) {
          if (action.checked === Boolean(action.originalChecked)) {
            continue;
          }
          await submitToggleAction(action);
          action.originalChecked = action.checked;
        }

        const repoEntry = await saveRepositoryLists(repoKey, actions);
        renderRepositoryChips(wrapper, repoEntry);
        closeRepositoryPanel();
      } catch (error) {
        console.error("GithubStarListsPlus save repository lists failed", error);
        saveButton.disabled = false;
        saveButton.textContent = "重试保存";
      }
    });

    actions.forEach((action) => {
      action.originalChecked = action.checked;
    });

    const clickAway = (event) => {
      if (!panel.contains(event.target) && !wrapper.contains(event.target)) {
        closeRepositoryPanel();
      }
    };

    document.addEventListener("mousedown", clickAway, true);
    state.repoPanelCleanup = () => {
      document.removeEventListener("mousedown", clickAway, true);
    };
  }

  async function setupRepositoryPage() {
    state.settings = await storage.getSettings();
    const repoNwo = core.readRepositoryNwo();
    const control = pickVisibleStarControl(repoNwo);
    if (!control?.button) {
      state.pageCleanup = () => {};
      return;
    }

    let wrapper = document.querySelector(".github-star-lists-plus-repo-control");
    if (!wrapper) {
      wrapper = document.createElement("div");
      wrapper.className = "github-star-lists-plus-repo-control";
      wrapper.innerHTML = `
        <button type="button" class="github-star-lists-plus-repo-manage">Lists</button>
      `;
      control.container.insertAdjacentElement("afterend", wrapper);
    }

    const repoKey = repoNwo.toLowerCase();
    const cacheEntries = await storage.getRepoCacheEntries([repoKey]);
    renderRepositoryChips(wrapper, cacheEntries[repoKey] || {});

    const manageButton = wrapper.querySelector(".github-star-lists-plus-repo-manage");
    manageButton.disabled = !isRepositoryStarred(control);
    manageButton.addEventListener("click", () => {
      openRepositoryPanel(wrapper, repoKey).catch((error) => {
        console.error("GithubStarListsPlus open repository panel failed", error);
      });
    });

    if (!control.form.dataset.githubStarListsPlusBound) {
      control.form.dataset.githubStarListsPlusBound = "true";
      control.form.addEventListener("submit", () => {
        const shouldAutoOpen = state.settings?.autoOpenAfterStar && !isRepositoryStarred(control);
        if (!shouldAutoOpen) {
          return;
        }

        globalThis.setTimeout(async () => {
          const nextControl = pickVisibleStarControl(repoNwo);
          if (!nextControl) {
            return;
          }
          const nextManageButton = document.querySelector(".github-star-lists-plus-repo-manage");
          if (nextManageButton) {
            nextManageButton.disabled = false;
          }
          try {
            await openRepositoryPanel(wrapper, repoKey);
          } catch (error) {
            console.error("GithubStarListsPlus auto-open failed", error);
          }
        }, 1400);
      });
    }

    state.pageCleanup = () => {
      closeRepositoryPanel();
      document.querySelector(".github-star-lists-plus-repo-control")?.remove();
    };
  }

  watchRouteChanges();
  refreshRoute().catch((error) => {
    console.error("GithubStarListsPlus bootstrap failed", error);
  });
})();
