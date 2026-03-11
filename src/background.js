importScripts("./shared/base.js", "./shared/storage.js", "./shared/service.js");

(() => {
  const runtime = globalThis.GithubStarListsPlusCore.runtimeApi.runtime;
  const service = globalThis.GithubStarListsPlusService;

  runtime.onMessage.addListener((message, _sender, sendResponse) => {
    service.handleMessage(message)
      .then((response) => {
        sendResponse(response);
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error.message || String(error) });
      });

    return true;
  });
})();
