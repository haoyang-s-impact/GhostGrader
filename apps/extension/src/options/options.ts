import { loadSettings, saveSettings } from "../settings";

const apiBase = document.getElementById("apiBase") as HTMLInputElement;
const webBase = document.getElementById("webBase") as HTMLInputElement;
const teacherId = document.getElementById("teacherId") as HTMLInputElement;
const status = document.getElementById("status")!;

void loadSettings().then((s) => {
  apiBase.value = s.apiBase;
  webBase.value = s.webBase;
  teacherId.value = s.teacherId;
});

document.getElementById("save")!.addEventListener("click", async () => {
  await saveSettings({ apiBase: apiBase.value.trim() || "http://localhost:8787", webBase: webBase.value.trim() || "http://localhost:5173", teacherId: teacherId.value.trim() || "t-demo" });
  status.textContent = "Saved";
  setTimeout(() => (status.textContent = ""), 1500);
});
