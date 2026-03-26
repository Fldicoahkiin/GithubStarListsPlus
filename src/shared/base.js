(() => {
  const runtimeApi = globalThis.browser || globalThis.chrome;

  const DEFAULT_SETTINGS = Object.freeze({
    showStarDate: true,
    hideGroupedInAll: true,
    showListBadges: true,
    showThemeSuggestions: true,
    adaptToTheme: true,
    autoOpenAfterStar: true,
    enableBatchSelection: true,
    themeSuggestionVersion: 1,
    token: ""
  });

  const STORAGE_KEYS = Object.freeze({
    settings: "githubStarListsPlusSettings",
    repoCache: "githubStarListsPlusRepoCache",
    listCatalog: "githubStarListsPlusListCatalog"
  });

  const MESSAGE_TYPES = Object.freeze({
    getStarMetadata: "github-star-lists-plus:get-star-metadata",
    bulkUnstar: "github-star-lists-plus:bulk-unstar"
  });

  function callChrome(target, method, args = []) {
    const fn = target?.[method];
    if (typeof fn !== "function") {
      return Promise.reject(new Error(`Extension API not available: ${method}`));
    }

    if (globalThis.browser) {
      try {
        const result = fn.apply(target, args);
        if (result && typeof result.then === "function") {
          return result;
        }

        return Promise.resolve(result);
      } catch (error) {
        return Promise.reject(error);
      }
    }

    return new Promise((resolve, reject) => {
      try {
        fn.call(target, ...args, (value) => {
          const error = globalThis.chrome?.runtime?.lastError || runtimeApi.runtime?.lastError || runtimeApi.lastError;
          if (error) {
            reject(new Error(error.message));
            return;
          }
          resolve(value);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function normalizeRepoKey(owner, repo) {
    if (!owner || !repo) {
      return "";
    }

    return `${owner}/${repo}`.toLowerCase();
  }

  function splitRepoKey(repoKey) {
    const [owner = "", repo = ""] = String(repoKey || "").split("/");
    return { owner, repo };
  }

  function parseRepositoryPath(pathname) {
    const parts = String(pathname || "")
      .split("/")
      .filter(Boolean);

    if (parts.length !== 2) {
      return null;
    }

    const [owner, repo] = parts;

    if (!owner || !repo || repo.endsWith(".atom")) {
      return null;
    }

    return {
      owner,
      repo,
      key: normalizeRepoKey(owner, repo)
    };
  }

  function parseRepositoryUrl(urlValue) {
    try {
      const url = new URL(urlValue, location.origin);
      return parseRepositoryPath(url.pathname);
    } catch (_error) {
      return null;
    }
  }

  function parseListIdentity(urlValue) {
    try {
      const url = new URL(urlValue, location.origin);
      const listParam = url.searchParams.get("list");

      if (url.pathname === "/stars" && listParam) {
        return {
          id: listParam,
          url: url.toString()
        };
      }

      const parts = url.pathname.split("/").filter(Boolean);

      // /stars/USERNAME/lists/LIST-NAME
      if (parts.length >= 4 && parts[0] === "stars" && parts[2] === "lists") {
        return {
          id: parts.slice(3).join("/"),
          url: url.toString()
        };
      }

      // /stars/lists/LIST-NAME (legacy format without username)
      if (parts.length >= 3 && parts[0] === "stars" && parts[1] === "lists") {
        return {
          id: parts.slice(2).join("/"),
          url: url.toString()
        };
      }

      return null;
    } catch (_error) {
      return null;
    }
  }

  function formatStarDate(value) {
    if (!value) {
      return "";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "";
    }

    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    return `${y}/${m}/${d} ${hh}:${mm}`;
  }

  function debounce(fn, wait = 180) {
    let timer = 0;
    return (...args) => {
      clearTimeout(timer);
      timer = globalThis.setTimeout(() => fn(...args), wait);
    };
  }

  function wait(ms) {
    return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
  }

  function readUserLogin() {
    const meta = document.querySelector('meta[name="user-login"], meta[name="octolytics-actor-login"]');
    return meta?.content?.trim() || "";
  }

  function readRepositoryNwo() {
    const meta = document.querySelector('meta[name="octolytics-dimension-repository_nwo"]');
    return meta?.content?.trim() || "";
  }

  globalThis.GithubStarListsPlusCore = {
    runtimeApi,
    DEFAULT_SETTINGS,
    STORAGE_KEYS,
    MESSAGE_TYPES,
    callChrome,
    normalizeRepoKey,
    splitRepoKey,
    parseRepositoryPath,
    parseRepositoryUrl,
    parseListIdentity,
    formatStarDate,
    debounce,
    wait,
    readUserLogin,
    readRepositoryNwo
  };
})();
