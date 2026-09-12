import { lms } from "../api";
import { esc, go } from "../util";
import { bindHeader, renderHeader } from "./header";

export async function coursesView(app: HTMLElement) {
  const [teachers, courses, assignments] = await Promise.all([lms.teachers(), lms.courses(), lms.assignments()]);
  app.innerHTML = `
    ${renderHeader(teachers, "Dashboard")}
    <main class="sg-page">
      <div class="sg-page-head">
        <h1>Courses</h1>
        <form id="new-course" class="sg-inline-form">
          <input name="name" class="sg-input" placeholder="New course name, e.g. BIO 120: Cell Biology" required />
          <input name="term" class="sg-input sg-input-sm" placeholder="Term" />
          <button class="sg-btn sg-btn-primary" type="submit">Add course</button>
        </form>
      </div>
      ${courses.length === 0 ? `<p class="sg-empty">No courses yet. Add one above.</p>` : ""}
      <div class="sg-cards">
        ${courses
          .map((c) => {
            const as = assignments.filter((a) => a.courseId === c.id);
            return `<section class="sg-card" data-course-id="${c.id}">
              <div class="sg-card-head"><h2>${esc(c.name)}</h2><span class="sg-muted">${esc(c.term)}</span></div>
              <ul class="sg-list">
                ${as.length === 0 ? `<li class="sg-muted">No assignments yet.</li>` : ""}
                ${as
                  .map(
                    (a) => `<li>
                      <a href="#/grade/${a.id}/1" class="sg-link" data-assignment-title>${esc(a.title)}</a>
                      <span class="sg-muted">${a.rubric.criteria.length} criteria</span>
                      <span class="sg-spacer"></span>
                      <a href="#/assignments/${a.id}/rubric" class="sg-btn sg-btn-sm">Edit rubric</a>
                      <a href="#/grade/${a.id}/1" class="sg-btn sg-btn-sm sg-btn-primary">SpeedGrader</a>
                    </li>`,
                  )
                  .join("")}
              </ul>
              <a href="#/assignments/new/${c.id}" class="sg-btn sg-btn-sm" data-new-assignment>+ New assignment</a>
            </section>`;
          })
          .join("")}
      </div>
    </main>`;
  bindHeader();
  document.getElementById("new-course")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target as HTMLFormElement;
    const name = (f.elements.namedItem("name") as HTMLInputElement).value.trim();
    const term = (f.elements.namedItem("term") as HTMLInputElement).value.trim();
    if (!name) return;
    await lms.createCourse(name, term);
    go("#/courses");
    await coursesView(app);
  });
}
