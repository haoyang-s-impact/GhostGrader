import { GHOST_GRADER_URL } from "../api";

export function renderHeader(crumb: string): string {
  return `
  <header class="sg-header">
    <div class="sg-brand"><a class="sg-logo" href="#/courses" title="Courses">C</a><span class="sg-crumb">${crumb}</span></div>
    <div class="sg-nav">
      <span class="sg-user">Mock LMS · instructor view</span>
      <a class="sg-btn sg-btn-sm sg-btn-ghost" href="${GHOST_GRADER_URL}" target="_blank" rel="noreferrer">Open Ghost Grader ↗</a>
    </div>
  </header>`;
}
