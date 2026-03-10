(() => {
  const core = globalThis.StarListsCore;
  const storageApi = core.runtimeApi.storage;

  async function getSyncObject(defaults) {
    return core.callChrome(storageApi.sync, "get", [defaults]);
  }

  async function setSyncObject(value) {
    return core.callChrome(storageApi.sync, "set", [value]);
  }

  async function getLocalObject(defaults) {
    return core.callChrome(storageApi.local, "get", [defaults]);
  }

  async function setLocalObject(value) {
    return core.callChrome(storageApi.local, "set", [value]);
  }

  async function getSettings() {
    const syncData = await getSyncObject({
      [core.STORAGE_KEYS.settings]: core.DEFAULT_SETTINGS
    });
    const stored = syncData[core.STORAGE_KEYS.settings] || {};

    return {
      ...core.DEFAULT_SETTINGS,
      ...stored
    };
  }

  async function saveSettings(patch) {
    const current = await getSettings();
    const nextSettings = {
      ...current,
      ...patch
    };

    await setSyncObject({
      [core.STORAGE_KEYS.settings]: nextSettings
    });

    return nextSettings;
  }

  async function getRepoCache() {
    const localData = await getLocalObject({
      [core.STORAGE_KEYS.repoCache]: {}
    });

    return localData[core.STORAGE_KEYS.repoCache] || {};
  }

  async function getRepoCacheEntries(repoKeys) {
    const repoCache = await getRepoCache();

    if (!Array.isArray(repoKeys) || repoKeys.length === 0) {
      return repoCache;
    }

    return repoKeys.reduce((result, repoKey) => {
      if (repoCache[repoKey]) {
        result[repoKey] = repoCache[repoKey];
      }
      return result;
    }, {});
  }

  async function mergeRepoCache(patch) {
    const repoCache = await getRepoCache();
    const nextCache = {
      ...repoCache,
      ...patch
    };

    await setLocalObject({
      [core.STORAGE_KEYS.repoCache]: nextCache
    });

    return nextCache;
  }

  async function getListCatalog() {
    const localData = await getLocalObject({
      [core.STORAGE_KEYS.listCatalog]: { items: [], updatedAt: 0 }
    });

    return localData[core.STORAGE_KEYS.listCatalog] || { items: [], updatedAt: 0 };
  }

  async function saveListCatalog(items) {
    const nextCatalog = {
      items,
      updatedAt: Date.now()
    };

    await setLocalObject({
      [core.STORAGE_KEYS.listCatalog]: nextCatalog
    });

    return nextCatalog;
  }

  globalThis.StarListsStorage = {
    getSettings,
    saveSettings,
    getRepoCache,
    getRepoCacheEntries,
    mergeRepoCache,
    getListCatalog,
    saveListCatalog
  };
})();
