import { pageBridge } from "../page-bridge-core";

/**
 * Injects the page-world bridge once, then talks to it with postMessage.
 * Moodle's TinyMCE editors are only reachable from the page's own world.
 * Inside the extension the bridge is loaded from page-bridge.js; in embed
 * mode (no chrome.runtime) the same function is inlined as a script tag.
 */
let injected: Promise<void> | null = null;

function hasRuntime(): boolean {
  try {
    return typeof chrome !== "undefined" && Boolean(chrome.runtime?.getURL);
  } catch {
    return false;
  }
}

export function ensureBridge(): Promise<void> {
  if (injected) return injected;
  injected = new Promise((resolve) => {
    const s = document.createElement("script");
    if (hasRuntime()) {
      s.src = chrome.runtime.getURL("page-bridge.js");
      s.onload = () => {
        s.remove();
        resolve();
      };
      s.onerror = () => resolve(); // fall back to the textarea write in setComment
    } else {
      s.textContent = `(${pageBridge.toString()})();`;
    }
    (document.head ?? document.documentElement).appendChild(s);
    if (!hasRuntime()) {
      s.remove();
      resolve();
    }
  });
  return injected;
}

export async function setComment(editorId: string, html: string): Promise<boolean> {
  await ensureBridge();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      window.removeEventListener("message", onDone);
      // Bridge did not answer: write the textarea directly so the value still submits.
      const ta = document.getElementById(editorId) as HTMLTextAreaElement | null;
      if (ta) ta.value = html;
      resolve(false);
    }, 800);
    const onDone = (e: MessageEvent) => {
      const d = e.data as { source?: string; type?: string; editorId?: string; viaEditor?: boolean } | undefined;
      if (e.source !== window || !d || d.source !== "ghost-grader" || d.type !== "set-comment:done" || d.editorId !== editorId) return;
      clearTimeout(timer);
      window.removeEventListener("message", onDone);
      resolve(Boolean(d.viaEditor));
    };
    window.addEventListener("message", onDone);
    window.postMessage({ source: "ghost-grader", type: "set-comment", editorId, html }, "*");
  });
}
