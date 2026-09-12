import { createRoot } from "react-dom/client";
import { Panel } from "./Panel";
import css from "./panel.css?inline";

const HOST_ID = "ghost-grader-host";

function mount() {
  if (document.getElementById(HOST_ID)) return;
  const host = document.createElement("div");
  host.id = HOST_ID;
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = css;
  shadow.appendChild(style);
  const container = document.createElement("div");
  shadow.appendChild(container);
  // Make room so the panel does not cover the grading column.
  document.body.style.marginRight = "380px";
  createRoot(container).render(<Panel />);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
else mount();
