import type { Decision } from "@gg/shared";

/**
 * Mirror of the session's decisions in extension storage, so a backend
 * restart mid-demo can be recovered by replaying them.
 */
function key(assignmentId: string) {
  return `gg:decisions:${assignmentId}`;
}

function hasChromeStorage(): boolean {
  return typeof chrome !== "undefined" && !!chrome.storage?.local;
}

export async function loadMirror(assignmentId: string): Promise<Decision[]> {
  if (!hasChromeStorage()) return [];
  try {
    const k = key(assignmentId);
    const got = await chrome.storage.local.get(k);
    const v = got[k];
    return Array.isArray(v) ? (v as Decision[]) : [];
  } catch {
    return [];
  }
}

export async function saveMirror(assignmentId: string, decisions: Decision[]): Promise<void> {
  if (!hasChromeStorage()) return;
  try {
    await chrome.storage.local.set({ [key(assignmentId)]: decisions });
  } catch {
    /* storage is a convenience, never block grading */
  }
}
