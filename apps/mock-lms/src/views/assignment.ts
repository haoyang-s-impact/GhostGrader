import { lms } from "../api";
import { esc } from "../util";
import { renderHeader } from "./header";

/** One assignment as the LMS holds it: its questions and every student's answer to each. */
export async function assignmentView(app: HTMLElement, assignmentId: string) {
  const [a, submissions] = await Promise.all([lms.assignment(assignmentId), lms.submissions(assignmentId)]);
  const questions = [...a.questions].sort((x, y) => x.position - y.position);
  app.innerHTML = `
    ${renderHeader(`<a href="#/courses">Courses</a> › ${esc(a.course_name)} › <strong>${esc(a.name)}</strong>`)}
    <main class="sg-page">
      <div class="sg-page-head">
        <h1>${esc(a.name)}</h1>
        <a href="#/assignments/${esc(a.id)}/gradebook" class="sg-btn sg-btn-sm sg-btn-primary">Gradebook</a>
      </div>
      ${questions
        .map((q) => {
          const subs = submissions.filter((s) => s.question_id === q.id).sort((x, y) => x.user_id.localeCompare(y.user_id));
          return `<section class="sg-card" data-lms-question="${esc(q.id)}">
            <div class="sg-card-head"><h2>Question ${q.position}: ${esc(q.name)}</h2><span class="sg-muted">${q.points_possible} pts · ${subs.length} submissions</span></div>
            <p class="sg-prompt">${esc(q.question_text)}</p>
            <ul class="sg-list">
              ${subs
                .map(
                  (s) => `<li class="sg-sub" data-lms-submission="${esc(s.id)}">
                    <details><summary><strong>${esc(s.user_name)}</strong> <span class="sg-muted">${esc(s.user_id)}</span></summary><div class="sg-essay">${esc(s.body)}</div></details>
                  </li>`,
                )
                .join("")}
            </ul>
          </section>`;
        })
        .join("")}
    </main>`;
}
