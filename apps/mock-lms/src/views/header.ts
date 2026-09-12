import type { Teacher } from "@gg/shared";
import { currentTeacherId, setCurrentTeacherId } from "../api";
import { esc } from "../util";

export function renderHeader(teachers: Teacher[], crumb: string, right = ""): string {
  const me = teachers.find((t) => t.id === currentTeacherId()) ?? teachers[0];
  return `
  <header class="sg-header" data-gg-teacher-id="${esc(me?.id ?? "")}">
    <div class="sg-brand"><a class="sg-logo" href="#/courses" title="Dashboard">C</a><span class="sg-crumb">${crumb}</span></div>
    <div class="sg-nav">
      ${right}
      <label class="sg-user">Signed in as
        <select id="teacher-switch" class="sg-select" aria-label="Switch teacher">
          ${teachers.map((t) => `<option value="${t.id}" ${t.id === me?.id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}
        </select>
      </label>
    </div>
  </header>`;
}

export function bindHeader() {
  document.getElementById("teacher-switch")?.addEventListener("change", (e) => {
    setCurrentTeacherId((e.target as HTMLSelectElement).value);
    location.hash = "#/courses";
    location.reload();
  });
}
