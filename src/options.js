(async () => {
  const storage = globalThis.GithubStarListsPlusStorage;
  const elements = {
    showStarDate: document.getElementById("showStarDate"),
    hideGroupedInAll: document.getElementById("hideGroupedInAll"),
    showListBadges: document.getElementById("showListBadges"),
    autoOpenAfterStar: document.getElementById("autoOpenAfterStar"),
    token: document.getElementById("token"),
    saveButton: document.getElementById("saveButton"),
    statusText: document.getElementById("statusText")
  };

  async function hydrate() {
    const settings = await storage.getSettings();
    elements.showStarDate.checked = Boolean(settings.showStarDate);
    elements.hideGroupedInAll.checked = Boolean(settings.hideGroupedInAll);
    elements.showListBadges.checked = Boolean(settings.showListBadges);
    elements.autoOpenAfterStar.checked = Boolean(settings.autoOpenAfterStar);
    elements.token.value = settings.token || "";
  }

  async function save() {
    elements.saveButton.disabled = true;
    elements.statusText.textContent = "Saving...";

    await storage.saveSettings({
      showStarDate: elements.showStarDate.checked,
      hideGroupedInAll: elements.hideGroupedInAll.checked,
      showListBadges: elements.showListBadges.checked,
      autoOpenAfterStar: elements.autoOpenAfterStar.checked,
      token: elements.token.value.trim()
    });

    elements.statusText.textContent = "Saved";
    elements.saveButton.disabled = false;

    globalThis.setTimeout(() => {
      elements.statusText.textContent = "";
    }, 1800);
  }

  elements.saveButton.addEventListener("click", () => {
    save().catch((error) => {
      elements.statusText.textContent = error.message || String(error);
      elements.saveButton.disabled = false;
    });
  });

  hydrate().catch((error) => {
    elements.statusText.textContent = error.message || String(error);
  });
})();
