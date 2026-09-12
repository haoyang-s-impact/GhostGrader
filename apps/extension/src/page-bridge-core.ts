/**
 * The page-world half of the TinyMCE bridge, written as one self-contained
 * function so it can be injected two ways: as the extension's page-bridge.js
 * file, or inlined as a <script> when the content script runs without an
 * extension (embed mode for demos). It must not reference anything outside
 * itself.
 */
export function pageBridge() {
  interface TinyLike {
    get: (id: string) => { setContent: (html: string) => void; save?: () => void } | null;
  }
  const w = window as unknown as { tinymce?: TinyLike; __ggBridge?: boolean };
  if (w.__ggBridge) return;
  w.__ggBridge = true;
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const msg = event.data as { source?: string; type?: string; editorId?: string; html?: string } | undefined;
    if (!msg || msg.source !== "ghost-grader" || msg.type !== "set-comment" || !msg.editorId) return;
    const editor = w.tinymce?.get(msg.editorId);
    const textarea = document.getElementById(msg.editorId) as HTMLTextAreaElement | null;
    if (editor) {
      editor.setContent(msg.html ?? "");
      editor.save?.();
    }
    if (textarea) {
      textarea.value = msg.html ?? "";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
    }
    window.postMessage({ source: "ghost-grader", type: "set-comment:done", editorId: msg.editorId, viaEditor: Boolean(editor) }, "*");
  });
}
