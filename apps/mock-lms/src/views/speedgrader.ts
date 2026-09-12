import type { Assignment, StoredSubmission } from "@gg/shared";
import { lms } from "../api";
import { esc, go } from "../util";
import { bindHeader, renderHeader } from "./header";

type Grades = Record<string, { points: Record<string, number | null>; comment: string }>;

export async function speedGraderView(app: HTMLElement, assignmentId: string, index: number) {
  const [teachers, assignment, submissions] = await Promise.all([lms.teachers(), lms.assignment(assignmentId), lms.submissions(assignmentId)]);
  const STORAGE_KEY = `gg-mock-grades:${assignment.id}`;
  const grades: Grades = load();
  function load(): Grades {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    } catch {
      return {};
    }
  }
  const save = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(grades));
  const gradeFor = (s: StoredSubmission) => (grades[s.id] ??= { points: Object.fromEntries(assignment.rubric.criteria.map((c) => [c.id, null])), comment: "" });

  const crumb = `<a href="#/courses">${esc(assignment.course)}</a> › Assignments › <strong>${esc(assignment.title)}</strong>`;

  if (submissions.length === 0) {
    app.innerHTML = `${renderHeader(teachers, crumb)}${addSubmissionPanel(assignment, [])}`;
    bindHeader();
    bindAddSubmission(app, assignment.id, () => speedGraderView(app, assignmentId, 1));
    return;
  }

  const safeIndex = Math.min(Math.max(1, index), submissions.length);
  const sub = submissions.find((s) => s.index === safeIndex) ?? submissions[0]!;
  const g = gradeFor(sub);
  const total = Object.values(g.points).reduce<number>((acc, v) => acc + (v ?? 0), 0);
  const max = assignment.rubric.criteria.reduce((acc, c) => acc + c.maxPoints, 0);
  const graded = submissions.filter((s) => Object.values(gradeFor(s).points).some((v) => v !== null)).length;

  const nav = `
      <span class="sg-progress">${graded}/${submissions.length} graded</span>
      <button class="sg-btn" id="prev" ${sub.index === 1 ? "disabled" : ""} aria-label="Previous student">‹</button>
      <select id="picker" class="sg-select" aria-label="Select student">
        ${submissions.map((s) => `<option value="${s.index}" ${s.index === sub.index ? "selected" : ""}>${s.index}. ${esc(s.studentName)}</option>`).join("")}
      </select>
      <button class="sg-btn" id="next" ${sub.index === submissions.length ? "disabled" : ""} aria-label="Next student">›</button>
      <span class="sg-counter">${sub.index} / ${submissions.length}</span>
      <a href="#/assignments/${assignment.id}/rubric" class="sg-btn sg-btn-sm sg-btn-ghost">Rubric</a>`;

  app.innerHTML = `
  ${renderHeader(teachers, crumb, nav)}
  <div class="sg-assignment-meta" data-gg-assignment-id="${assignment.id}" hidden></div>
  <main class="sg-main" data-gg-submission-id="${sub.id}" data-gg-submission-index="${sub.index}" data-gg-submission-total="${submissions.length}">
    <section class="sg-submission">
      <div class="sg-student"><div class="sg-avatar">${esc(sub.studentName[0] ?? "?")}</div><div><div class="sg-name" data-gg-student-name>${esc(sub.studentName)}</div><div class="sg-meta">Submitted on time · Text entry</div></div></div>
      <h2 class="sg-prompt-title">Prompt</h2>
      <p class="sg-prompt">${esc(assignment.prompt)}</p>
      <h2 class="sg-prompt-title">Response</h2>
      <article class="sg-essay" data-gg-essay>${esc(sub.text)}</article>
      <details class="sg-add-more"><summary>Add another submission</summary>${addSubmissionForm()}</details>
    </section>
    <aside class="sg-grading">
      <div class="sg-grade-total"><span>Grade</span><strong data-gg-total>${total}</strong><span class="sg-muted">/ ${max}</span></div>
      <h3>Rubric</h3>
      <table class="sg-rubric" data-gg-rubric>
        <thead><tr><th>Criterion</th><th>Ratings</th><th class="sg-pts-col">Pts</th></tr></thead>
        <tbody>
        ${assignment.rubric.criteria
          .map((c) => {
            const v = g.points[c.id];
            return `<tr data-gg-criterion-id="${c.id}" data-gg-criterion-max="${c.maxPoints}">
              <td class="sg-crit"><div class="sg-crit-title" data-gg-criterion-title>${esc(c.title)}</div><div class="sg-crit-desc">${esc(c.description)}</div></td>
              <td class="sg-bands">${c.bands
                .map((b) => `<button class="sg-band ${v === b.points ? "is-selected" : ""}" data-band-points="${b.points}" data-crit="${c.id}" title="${esc(b.descriptor)}"><span class="sg-band-pts">${b.points}</span><span class="sg-band-lvl">${esc(b.level)}</span></button>`)
                .join("")}</td>
              <td class="sg-pts"><input type="number" step="0.5" min="0" max="${c.maxPoints}" class="sg-pts-input" data-gg-points data-crit="${c.id}" value="${v ?? ""}" aria-label="${esc(c.title)} points" /><span class="sg-muted">/ ${c.maxPoints}</span></td>
            </tr>`;
          })
          .join("")}
        </tbody>
      </table>
      <h3>Assignment Comments</h3>
      <textarea class="sg-comment" data-gg-comment placeholder="Add a comment" rows="6">${esc(g.comment)}</textarea>
      <div class="sg-actions"><button class="sg-btn sg-btn-primary" id="submit">Submit</button><span class="sg-saved" id="saved"></span></div>
    </aside>
  </main>`;
  bindHeader();

  const goTo = (n: number) => go(`#/grade/${assignment.id}/${n}`);
  document.getElementById("prev")!.addEventListener("click", () => goTo(sub.index - 1));
  document.getElementById("next")!.addEventListener("click", () => goTo(sub.index + 1));
  document.getElementById("picker")!.addEventListener("change", (e) => goTo(Number((e.target as HTMLSelectElement).value)));

  app.querySelectorAll<HTMLButtonElement>(".sg-band").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = app.querySelector<HTMLInputElement>(`input[data-crit="${btn.dataset.crit}"]`)!;
      input.value = btn.dataset.bandPoints!;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });

  app.querySelectorAll<HTMLInputElement>("input[data-gg-points]").forEach((input) => {
    input.addEventListener("input", () => {
      const critId = input.dataset.crit!;
      const raw = input.value.trim();
      g.points[critId] = raw === "" ? null : Number(raw);
      save();
      const row = input.closest("tr")!;
      row.querySelectorAll<HTMLButtonElement>(".sg-band").forEach((b) => b.classList.toggle("is-selected", Number(b.dataset.bandPoints) === g.points[critId]));
      const t = Object.values(g.points).reduce<number>((acc, v) => acc + (v ?? 0), 0);
      app.querySelector("[data-gg-total]")!.textContent = String(t);
    });
  });

  const comment = app.querySelector<HTMLTextAreaElement>("[data-gg-comment]")!;
  comment.addEventListener("input", () => {
    g.comment = comment.value;
    save();
  });

  document.getElementById("submit")!.addEventListener("click", () => {
    save();
    const s = document.getElementById("saved")!;
    s.textContent = "Saved";
    setTimeout(() => (s.textContent = ""), 1500);
  });

  bindAddSubmission(app, assignment.id, () => speedGraderView(app, assignmentId, submissions.length + 1));
}

function addSubmissionForm(): string {
  return `<form class="sg-add-form" data-add-submission>
      <input class="sg-input" name="studentName" placeholder="Student name" required />
      <textarea class="sg-textarea" name="text" rows="5" placeholder="Paste the student's response" required></textarea>
      <button class="sg-btn sg-btn-primary" type="submit">Add submission</button>
    </form>`;
}

function addSubmissionPanel(assignment: Assignment, _subs: StoredSubmission[]): string {
  return `<main class="sg-page" data-gg-assignment-id="${assignment.id}">
    <h1>${esc(assignment.title)}</h1>
    <p class="sg-help">No submissions yet. Add a student response to start grading with Ghost Grader against this assignment's rubric (${assignment.rubric.criteria.length} criteria).</p>
    <section class="sg-card">${addSubmissionForm()}</section>
    <p><a href="#/assignments/${assignment.id}/rubric" class="sg-link">Edit rubric</a> · <a href="#/courses" class="sg-link">Dashboard</a></p>
  </main>`;
}

function bindAddSubmission(app: HTMLElement, assignmentId: string, after: () => void) {
  app.querySelectorAll<HTMLFormElement>("[data-add-submission]").forEach((form) =>
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = (form.elements.namedItem("studentName") as HTMLInputElement).value.trim();
      const text = (form.elements.namedItem("text") as HTMLTextAreaElement).value.trim();
      if (!name || !text) return;
      await lms.addSubmission(assignmentId, name, text);
      after();
    }),
  );
}
