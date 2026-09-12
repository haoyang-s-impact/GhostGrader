// Intentionally minimal. The service worker exists so the extension has a
// stable id at runtime (Playwright reads it) and so future work has a place
// for alarms or cross-tab messaging. All logic lives in the content script.
chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.sync.get(["apiBase", "teacherId"]).then((v) => {
    const defaults: Record<string, string> = {};
    if (!v.apiBase) defaults.apiBase = "http://localhost:8787";
    if (!v.teacherId) defaults.teacherId = "t-demo";
    if (Object.keys(defaults).length) void chrome.storage.sync.set(defaults);
  });
});
