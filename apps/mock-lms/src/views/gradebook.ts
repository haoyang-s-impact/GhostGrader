import { GHOST_GRADER_URL, lms } from "../api";
import { esc } from "../util";
import { renderHeader } from "./header";

const POLL_MS = 2000;
let pollTimer: number | undefined;

/**
 * Students × questions. Starts empty and fills in as Ghost Grader pushes
 * grades. It polls, so a push shows up here without reloading the page.
 */
export async function gradebookView(app: HTMLElement, assignmentId: string) {
  window.clearInterval(pollTimer);
  const [a, submissions, users] = await Promise.all([lms.assignment(assignmentId), lms.submissions(assignmentId), lms.users()]);
  const questions = [...a.questions].sort((x, y) => x.position - y.position);
  const enrolled = users.filter((u) => submissions.some((s) => s.user_id === u.id)).sort((x, y) => x.id.localeCompare(y.id));
  const total = questions.reduce((acc, q) => acc + q.points_possible, 0);
  const submitted = new Set(submissions.map((s) => `${s.question_id}|${s.user_id}`));

  app.innerHTML = `
    ${renderHeader(`<a href="#/courses">Courses</a> › ${esc(a.course_name)} › <a href="#/assignments/${esc(a.id)}">${esc(a.name)}</a> › <strong>Gradebook</strong>`)}
    <main class="sg-page sg-page-wide">
      <div class="sg-page-head">
        <h1>Gradebook</h1>
        <span class="sg-muted" id="gb-status" data-gradebook-status>Loading…</span>
      </div>
      <p class="sg-help">Grades appear here only when a teacher pushes them from <a class="sg-link" href="${GHOST_GRADER_URL}" target="_blank" rel="noreferrer">Ghost Grader</a>. Hover a grade to see the feedback sent with it.</p>
      <div class="sg-card sg-scroll">
        <table class="sg-gradebook" data-gradebook>
          <thead>
            <tr>
              <th>Student</th>
              ${questions.map((q) => `<th title="${esc(q.question_text)}">Q${q.position} · ${esc(q.name)}<div class="sg-muted">${q.points_possible} pts</div></th>`).join("")}
              <th>Total<div class="sg-muted">${total} pts</div></th>
            </tr>
          </thead>
          <tbody>
            ${enrolled
              .map(
                (u) => `<tr data-user="${esc(u.id)}">
                  <td><strong>${esc(u.name)}</strong></td>
                  ${questions
                    .map((q) =>
                      submitted.has(`${q.id}|${u.id}`)
                        ? `<td class="sg-cell" data-grade-cell="${esc(q.id)}|${esc(u.id)}">–</td>`
                        : `<td class="sg-cell is-na" title="No submission">n/a</td>`,
                    )
                    .join("")}
                  <td class="sg-cell sg-total" data-total="${esc(u.id)}">–</td>
                </tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </main>`;

  const refresh = async () => {
    // Stop polling once the teacher has navigated away from this gradebook.
    if (!document.querySelector("[data-gradebook]")) return window.clearInterval(pollTimer);
    try {
      const grades = await lms.grades(assignmentId);
      const byCell = new Map(grades.map((g) => [`${g.question_id}|${g.user_id}`, g]));
      document.querySelectorAll<HTMLElement>("[data-grade-cell]").forEach((td) => {
        const g = byCell.get(td.dataset.gradeCell!);
        const text = g ? String(g.score) : "–";
        if (td.textContent !== text) {
          td.textContent = text;
          td.title = g?.comment ? g.comment : "";
          td.classList.toggle("is-graded", Boolean(g));
          if (g) {
            td.classList.remove("is-new");
            void td.offsetWidth; // restart the highlight animation
            td.classList.add("is-new");
          }
        }
      });
      for (const u of enrolled) {
        const mine = grades.filter((g) => g.user_id === u.id);
        const cell = document.querySelector<HTMLElement>(`[data-total="${CSS.escape(u.id)}"]`);
        if (cell) cell.textContent = mine.length ? String(mine.reduce((acc, g) => acc + g.score, 0)) : "–";
      }
      const status = document.getElementById("gb-status");
      if (status) status.textContent = `${grades.length} grade${grades.length === 1 ? "" : "s"} received · updated ${new Date().toLocaleTimeString()}`;
    } catch {
      const status = document.getElementById("gb-status");
      if (status) status.textContent = "Could not reach the LMS server.";
    }
  };
  await refresh();
  pollTimer = window.setInterval(refresh, POLL_MS);
}
