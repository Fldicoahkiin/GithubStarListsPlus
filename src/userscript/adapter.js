(() => {
  const globalObject = globalThis;
  const storageNamespace = "github-star-lists-plus-userscript";
  const styleText = globalObject.__GITHUB_STAR_LISTS_PLUS_USERSTYLE__ || "";

  function resolveLegacyOrModern(legacyName, modernName) {
    if (typeof globalObject[legacyName] === "function") {
      return globalObject[legacyName].bind(globalObject);
    }

    const modern = globalObject.GM?.[modernName];
    if (typeof modern === "function") {
      return modern.bind(globalObject.GM);
    }

    return null;
  }

  const gmApi = {
    getValue: resolveLegacyOrModern("GM_getValue", "getValue"),
    setValue: resolveLegacyOrModern("GM_setValue", "setValue"),
    registerMenuCommand: resolveLegacyOrModern("GM_registerMenuCommand", "registerMenuCommand"),
    xmlHttpRequest: resolveLegacyOrModern("GM_xmlhttpRequest", "xmlHttpRequest")
  };

  function localStorageKey(areaName, key) {
    return `${storageNamespace}:${areaName}:${key}`;
  }

  async function readValue(areaName, key, fallbackValue) {
    if (gmApi.getValue) {
      return gmApi.getValue(localStorageKey(areaName, key), fallbackValue);
    }

    const rawValue = globalObject.localStorage.getItem(localStorageKey(areaName, key));
    if (rawValue === null) {
      return fallbackValue;
    }

    try {
      return JSON.parse(rawValue);
    } catch (_error) {
      return fallbackValue;
    }
  }

  async function writeValue(areaName, key, value) {
    if (gmApi.setValue) {
      await gmApi.setValue(localStorageKey(areaName, key), value);
      return;
    }

    globalObject.localStorage.setItem(localStorageKey(areaName, key), JSON.stringify(value));
  }

  function createStorageArea(areaName) {
    return {
      async get(defaults = {}) {
        const result = {};
        for (const [key, fallbackValue] of Object.entries(defaults)) {
          result[key] = await readValue(areaName, key, fallbackValue);
        }
        return result;
      },
      async set(values = {}) {
        for (const [key, value] of Object.entries(values)) {
          await writeValue(areaName, key, value);
        }
      }
    };
  }

  function waitForHead(callback) {
    if (document.head) {
      callback();
      return;
    }

    let observer = null;
    let completed = false;
    const handleReady = () => {
      if (completed || !document.head) {
        return;
      }

      completed = true;
      observer?.disconnect();
      document.removeEventListener("readystatechange", handleReady);
      callback();
    };

    document.addEventListener("readystatechange", handleReady);

    const attachObserver = () => {
      if (completed) {
        return;
      }

      if (document.head) {
        handleReady();
        return;
      }

      if (!document.documentElement) {
        globalObject.setTimeout(attachObserver, 0);
        return;
      }

      observer = new MutationObserver(handleReady);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
      handleReady();
    };

    attachObserver();
  }

  function installStyle(cssText) {
    if (!cssText) {
      return;
    }

    waitForHead(() => {
      if (document.getElementById("github-star-lists-plus-userscript-style")) {
        return;
      }

      const style = document.createElement("style");
      style.id = "github-star-lists-plus-userscript-style";
      style.textContent = cssText;
      document.head.appendChild(style);
    });
  }

  function normalizeHeaders(headers) {
    if (!headers) {
      return {};
    }

    if (headers instanceof Headers) {
      return Object.fromEntries(headers.entries());
    }

    return { ...headers };
  }

  async function requestViaFetch(url, options = {}) {
    return fetch(url, options);
  }

  async function requestViaGm(url, options = {}) {
    if (!gmApi.xmlHttpRequest) {
      return requestViaFetch(url, options);
    }

    return new Promise((resolve, reject) => {
      gmApi.xmlHttpRequest({
        url,
        method: options.method || "GET",
        headers: normalizeHeaders(options.headers),
        data: typeof options.body === "string" ? options.body : undefined,
        anonymous: false,
        onload: (response) => {
          const responseText = response.responseText || "";
          resolve({
            ok: response.status >= 200 && response.status < 300,
            status: response.status,
            text: async () => responseText,
            json: async () => JSON.parse(responseText || "null")
          });
        },
        onerror: () => {
          reject(new Error(`Userscript request failed: ${options.method || "GET"} ${url}`));
        },
        ontimeout: () => {
          reject(new Error(`Userscript request timed out: ${options.method || "GET"} ${url}`));
        }
      });
    });
  }

  async function sendMessage(message) {
    const service = globalObject.GithubStarListsPlusService;
    if (!service?.handleMessage) {
      throw new Error("GitHub StarLists++ userscript service is unavailable");
    }

    return service.handleMessage(message);
  }

  function registerMenuCommand(label, handler) {
    if (!gmApi.registerMenuCommand) {
      return null;
    }

    try {
      return gmApi.registerMenuCommand(label, handler);
    } catch (_error) {
      return null;
    }
  }

  globalObject.browser = {
    storage: {
      sync: createStorageArea("sync"),
      local: createStorageArea("local")
    },
    runtime: {
      sendMessage
    }
  };

  globalObject.GithubStarListsPlusPlatform = {
    kind: "userscript",
    request: requestViaGm,
    registerMenuCommand,
    installStyle,
    notify(message) {
      console.info(`[GitHub StarLists++] ${message}`);
    }
  };

  installStyle(styleText);
})();
