import { gradeMax, type Assignment, type StoredSubmission } from "@gg/shared";
import { lms } from "../api";
import { esc, go } from "../util";
import { bindHeader, renderHeader } from "./header";

type Grades = Record<string, { grade: number | null; comment: string }>;

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
  const gradeFor = (s: StoredSubmission) => (grades[s.id] ??= { grade: null, comment: "" });
  const max = gradeMax(assignment);

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
  const graded = submissions.filter((s) => gradeFor(s).grade !== null).length;

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
      <h3>Grade</h3>
      <div class="sg-grade-row">
        <input type="number" step="0.5" min="0" max="${max}" class="sg-grade-input" data-gg-grade data-gg-grade-max="${max}" value="${g.grade ?? ""}" aria-label="Grade out of ${max}" placeholder="–" />
        <span class="sg-grade-max">/ ${max}</span>
      </div>
      <p class="sg-help sg-grade-help">One overall grade. Ghost Grader compares it with the rubric and with the grades you gave other students.</p>
      <h3>Assignment Comments</h3>
      <textarea class="sg-comment" data-gg-comment placeholder="Add a comment" rows="8">${esc(g.comment)}</textarea>
      <div class="sg-actions"><button class="sg-btn sg-btn-primary" id="submit">Submit</button><span class="sg-saved" id="saved"></span></div>
    </aside>
  </main>`;
  bindHeader();

  const goTo = (n: number) => go(`#/grade/${assignment.id}/${n}`);
  document.getElementById("prev")!.addEventListener("click", () => goTo(sub.index - 1));
  document.getElementById("next")!.addEventListener("click", () => goTo(sub.index + 1));
  document.getElementById("picker")!.addEventListener("change", (e) => goTo(Number((e.target as HTMLSelectElement).value)));

  const gradeInput = app.querySelector<HTMLInputElement>("[data-gg-grade]")!;
  gradeInput.addEventListener("input", () => {
    const raw = gradeInput.value.trim();
    g.grade = raw === "" ? null : Number(raw);
    save();
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
