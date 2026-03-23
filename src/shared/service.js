(() => {
  const core = globalThis.GithubStarListsPlusCore;
  const storage = globalThis.GithubStarListsPlusStorage;

  function createHeaders(settings, accept) {
    const headers = {
      Accept: accept,
      "X-GitHub-Api-Version": "2022-11-28"
    };

    if (settings.token) {
      headers.Authorization = `Bearer ${settings.token}`;
    }

    return headers;
  }

  async function request(url, options) {
    const platformRequest = globalThis.GithubStarListsPlusPlatform?.request;
    if (typeof platformRequest === "function") {
      return platformRequest(url, options);
    }

    return fetch(url, options);
  }

  async function fetchJson(url, settings, accept) {
    const response = await request(url, {
      credentials: "include",
      headers: createHeaders(settings, accept)
    });

    if (!response.ok) {
      const error = new Error(`GitHub API request failed: ${response.status}`);
      error.status = response.status;
      throw error;
    }

    return response.json();
  }

  function buildCandidatePages(pageHint) {
    const starPage = Math.max(1, Number(pageHint || 1));
    const estimatedOffset = (starPage - 1) * 30;
    const estimatedApiPage = Math.floor(estimatedOffset / 100) + 1;
    const pages = new Set([estimatedApiPage, estimatedApiPage + 1, estimatedApiPage + 2, 1]);

    return [...pages].filter((value) => value > 0);
  }

  async function loadStarMetadata(repoKeys, pageHint, username) {
    const settings = await storage.getSettings();
    const repoCache = await storage.getRepoCacheEntries(repoKeys);
    const now = Date.now();
    const sixHours = 6 * 60 * 60 * 1000;
    const result = {};
    const missing = [];

    for (const repoKey of repoKeys) {
      const cached = repoCache[repoKey];
      if (cached?.starredAt && cached.starCheckedAt && now - cached.starCheckedAt < sixHours) {
        result[repoKey] = cached.starredAt;
      } else {
        missing.push(repoKey);
      }
    }

    if (missing.length === 0) {
      return result;
    }

    const unresolved = new Set(missing);
    const freshCache = {};
    const accept = "application/vnd.github.star+json";
    const urls = buildCandidatePages(pageHint).map((page) => ({
      authUrl: `https://api.github.com/user/starred?per_page=100&page=${page}&sort=created&direction=desc`,
      publicUrl: username
        ? `https://api.github.com/users/${encodeURIComponent(username)}/starred?per_page=100&page=${page}&sort=created&direction=desc`
        : ""
    }));

    for (const item of urls) {
      if (unresolved.size === 0) {
        break;
      }

      let payload = [];
      try {
        payload = await fetchJson(item.authUrl, settings, accept);
      } catch (error) {
        const canFallback = !settings.token && username && (error.status === 401 || error.status === 403 || error.status === 404);
        if (!canFallback || !item.publicUrl) {
          continue;
        }

        try {
          payload = await fetchJson(item.publicUrl, { token: "" }, accept);
        } catch (_fallbackError) {
          continue;
        }
      }

      if (!Array.isArray(payload) || payload.length === 0) {
        continue;
      }

      for (const entry of payload) {
        const repo = entry?.repo || entry;
        const starredAt = entry?.starred_at || "";
        if (!repo?.full_name) {
          continue;
        }

        const repoKey = String(repo.full_name).toLowerCase();
        if (!unresolved.has(repoKey)) {
          continue;
        }

        result[repoKey] = starredAt;
        freshCache[repoKey] = {
          ...(repoCache[repoKey] || {}),
          starredAt,
          starCheckedAt: now
        };
        unresolved.delete(repoKey);
      }
    }

    if (Object.keys(freshCache).length > 0) {
      await storage.mergeRepoCache(freshCache);
    }

    return result;
  }

  async function bulkUnstar(repoKeys) {
    const settings = await storage.getSettings();
    const failures = [];

    for (const repoKey of repoKeys) {
      const { owner, repo } = core.splitRepoKey(repoKey);
      if (!owner || !repo) {
        failures.push(repoKey);
        continue;
      }

      const response = await request(`https://api.github.com/user/starred/${owner}/${repo}`, {
        method: "DELETE",
        credentials: "include",
        headers: createHeaders(settings, "application/vnd.github+json")
      });

      if (!response.ok && response.status !== 404) {
        failures.push(repoKey);
      }
    }

    return {
      ok: failures.length === 0,
      failures
    };
  }

  async function handleMessage(message) {
    if (message?.type === core.MESSAGE_TYPES.getStarMetadata) {
      const data = await loadStarMetadata(message.repoKeys || [], message.pageHint, message.username);
      return { ok: true, data };
    }

    if (message?.type === core.MESSAGE_TYPES.bulkUnstar) {
      const data = await bulkUnstar(message.repoKeys || []);
      return { ok: true, data };
    }

    return { ok: false, error: "unknown-message" };
  }

  globalThis.GithubStarListsPlusService = {
    createHeaders,
    loadStarMetadata,
    bulkUnstar,
    handleMessage
  };
})();
