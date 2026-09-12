import { createRoot } from "react-dom/client";
import { loadSettings } from "../settings";
import { isManualGradingPage, parseGradingPage } from "./moodle";
import { Panel } from "./Panel";
import css from "./panel.css?inline";

const HOST_ID = "ghost-grader-host";

async function mount() {
  if (document.getElementById(HOST_ID)) return;
  if (!isManualGradingPage()) return;
  const page = parseGradingPage();
  if (!page || page.attempts.length === 0) return;
  const settings = await loadSettings();

  const host = document.createElement("div");
  host.id = HOST_ID;
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = css;
  shadow.appendChild(style);
  const container = document.createElement("div");
  shadow.appendChild(container);
  // Make room so the panel does not cover the marks column.
  document.body.style.marginRight = "400px";
  createRoot(container).render(<Panel page={page} settings={settings} />);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => void mount(), { once: true });
else void mount();
