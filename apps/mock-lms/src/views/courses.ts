import { lms } from "../api";
import { esc } from "../util";
import { renderHeader } from "./header";

export async function coursesView(app: HTMLElement) {
  const [courses, assignments] = await Promise.all([lms.courses(), lms.assignments()]);
  app.innerHTML = `
    ${renderHeader("Courses")}
    <main class="sg-page">
      <div class="sg-page-head"><h1>Courses</h1></div>
      <p class="sg-help">This is the LMS: the system of record for questions and student answers. Ghost Grader pulls them from here over the API and pushes grades back into the gradebook.</p>
      <div class="sg-cards">
        ${courses
          .map((c) => {
            const as = assignments.filter((a) => a.course_id === c.id);
            return `<section class="sg-card" data-course-id="${esc(c.id)}">
              <div class="sg-card-head"><h2>${esc(c.name)}</h2><span class="sg-muted">${esc(c.term)}</span></div>
              <ul class="sg-list">
                ${as.length === 0 ? `<li class="sg-muted">No assignments.</li>` : ""}
                ${as
                  .map(
                    (a) => `<li>
                      <a href="#/assignments/${esc(a.id)}" class="sg-link" data-assignment-title>${esc(a.name)}</a>
                      <span class="sg-muted">${a.questions.length} questions · ${a.questions.reduce((acc, q) => acc + q.points_possible, 0)} pts</span>
                      <span class="sg-spacer"></span>
                      <a href="#/assignments/${esc(a.id)}" class="sg-btn sg-btn-sm">Submissions</a>
                      <a href="#/assignments/${esc(a.id)}/gradebook" class="sg-btn sg-btn-sm sg-btn-primary">Gradebook</a>
                    </li>`,
                  )
                  .join("")}
              </ul>
            </section>`;
          })
          .join("")}
      </div>
    </main>`;
}
