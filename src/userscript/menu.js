(() => {
  const platform = globalThis.GithubStarListsPlusPlatform;
  const storage = globalThis.GithubStarListsPlusStorage;
  const core = globalThis.GithubStarListsPlusCore;

  if (!platform?.registerMenuCommand || !storage || !core) {
    return;
  }

  function showMessage(message) {
    platform.notify(message);
    globalThis.alert(message);
  }

  async function reloadAfterSave(message) {
    showMessage(message);
    globalThis.location.reload();
  }

  async function toggleSetting(key, label) {
    const settings = await storage.getSettings();
    const nextValue = !settings[key];
    await storage.saveSettings({ [key]: nextValue });
    await reloadAfterSave(`${label} is now ${nextValue ? "enabled" : "disabled"}. The page will reload.`);
  }

  async function configureToken() {
    const settings = await storage.getSettings();
    const nextValue = globalThis.prompt(
      "Paste a GitHub token for higher API quota. Leave empty to remove it.",
      settings.token || ""
    );

    if (nextValue === null) {
      return;
    }

    await storage.saveSettings({ token: nextValue.trim() });
    await reloadAfterSave(nextValue.trim() ? "GitHub token saved. The page will reload." : "GitHub token removed. The page will reload.");
  }

  async function resetCache() {
    await core.callChrome(globalThis.browser.storage.local, "set", [{
      [core.STORAGE_KEYS.repoCache]: {},
      [core.STORAGE_KEYS.listCatalog]: { items: [], updatedAt: 0 }
    }]);
    await reloadAfterSave("GitHub StarLists++ cache cleared. The page will reload.");
  }

  async function registerMenu() {
    const settings = await storage.getSettings();
    const commands = [
      [`GitHub StarLists++: ${settings.showStarDate ? "Disable" : "Enable"} starred date`, () => toggleSetting("showStarDate", "Starred date")],
      [`GitHub StarLists++: ${settings.hideGroupedInAll ? "Disable" : "Enable"} hide grouped repos in All`, () => toggleSetting("hideGroupedInAll", "Hide grouped repos in All")],
      [`GitHub StarLists++: ${settings.showListBadges ? "Disable" : "Enable"} Ungrouped label`, () => toggleSetting("showListBadges", "Ungrouped label")],
      [`GitHub StarLists++: ${settings.autoOpenAfterStar ? "Disable" : "Enable"} auto-open list panel`, () => toggleSetting("autoOpenAfterStar", "Auto-open list panel")],
      ["GitHub StarLists++: Configure GitHub token", configureToken],
      ["GitHub StarLists++: Reset cached metadata", resetCache]
    ];

    for (const [label, handler] of commands) {
      platform.registerMenuCommand(label, () => {
        handler().catch((error) => {
          showMessage(error.message || String(error));
        });
      });
    }
  }

  registerMenu().catch((error) => {
    console.error("GitHub StarLists++ userscript menu init failed", error);
  });
})();
