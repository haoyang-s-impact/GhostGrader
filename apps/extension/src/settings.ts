export interface Settings {
  apiBase: string;
  /** The Ghost Grader web app, for the rubric editor and gradebook links. */
  webBase: string;
  teacherId: string;
}

export const DEFAULT_SETTINGS: Settings = { apiBase: "http://localhost:8787", webBase: "http://localhost:5173", teacherId: "t-demo" };

export async function loadSettings(): Promise<Settings> {
  // Embed mode: the content bundle was loaded as a plain script and the host
  // page (or a bookmarklet) set window.__ggSettings before it ran.
  const embedded = (window as unknown as { __ggSettings?: Partial<Settings> }).__ggSettings;
  if (embedded) return { ...DEFAULT_SETTINGS, ...embedded };
  try {
    const v = await chrome.storage.sync.get(["apiBase", "webBase", "teacherId"]);
    return {
      apiBase: (typeof v.apiBase === "string" && v.apiBase.trim()) || DEFAULT_SETTINGS.apiBase,
      webBase: (typeof v.webBase === "string" && v.webBase.trim()) || DEFAULT_SETTINGS.webBase,
      teacherId: (typeof v.teacherId === "string" && v.teacherId.trim()) || DEFAULT_SETTINGS.teacherId,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(s: Settings): Promise<void> {
  await chrome.storage.sync.set({ apiBase: s.apiBase.replace(/\/$/, ""), webBase: s.webBase.replace(/\/$/, ""), teacherId: s.teacherId.trim() });
}
