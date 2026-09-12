import { assignment, submissions, type Submission } from "@gg/shared";

const app = document.getElementById("app")!;
const STORAGE_KEY = `gg-mock-grades:${assignment.id}`;

type Grades = Record<string, { points: Record<string, number | null>; comment: string }>;

function loadGrades(): Grades {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}
const grades: Grades = loadGrades();
function saveGrades() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(grades));
}
function gradeFor(sub: Submission) {
  grades[sub.id] ??= { points: Object.fromEntries(assignment.rubric.criteria.map((c) => [c.id, null])), comment: "" };
  return grades[sub.id]!;
}

function indexFromHash(): number {
  const n = Number(location.hash.replace("#", ""));
  return Number.isInteger(n) && n >= 1 && n <= submissions.length ? n : 1;
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
}

function render() {
  const index = indexFromHash();
  const sub = submissions.find((s) => s.index === index)!;
  const g = gradeFor(sub);
  const total = Object.values(g.points).reduce<number>((acc, v) => acc + (v ?? 0), 0);
  const max = assignment.rubric.criteria.reduce((acc, c) => acc + c.maxPoints, 0);
  const graded = submissions.filter((s) => Object.values(gradeFor(s).points).some((v) => v !== null)).length;

  app.innerHTML = `
  <header class="sg-header" data-gg-assignment-id="${assignment.id}">
    <div class="sg-brand"><span class="sg-logo">C</span><span class="sg-crumb">${esc(assignment.course)} › Assignments › <strong>${esc(assignment.title)}</strong></span></div>
    <div class="sg-nav">
      <span class="sg-progress">${graded}/${submissions.length} graded</span>
      <button class="sg-btn" id="prev" ${index === 1 ? "disabled" : ""} aria-label="Previous student">‹</button>
      <select id="picker" class="sg-select" aria-label="Select student">
        ${submissions.map((s) => `<option value="${s.index}" ${s.index === index ? "selected" : ""}>${s.index}. ${esc(s.studentName)}</option>`).join("")}
      </select>
      <button class="sg-btn" id="next" ${index === submissions.length ? "disabled" : ""} aria-label="Next student">›</button>
      <span class="sg-counter" data-gg-submission-index="${sub.index}">${sub.index} / ${submissions.length}</span>
    </div>
  </header>
  <main class="sg-main" data-gg-submission-id="${sub.id}" data-gg-submission-index="${sub.index}">
    <section class="sg-submission">
      <div class="sg-student"><div class="sg-avatar">${esc(sub.studentName[0] ?? "?")}</div><div><div class="sg-name" data-gg-student-name>${esc(sub.studentName)}</div><div class="sg-meta">Submitted on time · Text entry</div></div></div>
      <h2 class="sg-prompt-title">Prompt</h2>
      <p class="sg-prompt">${esc(assignment.prompt)}</p>
      <h2 class="sg-prompt-title">Response</h2>
      <article class="sg-essay" data-gg-essay>${esc(sub.text)}</article>
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

  const go = (n: number) => {
    location.hash = String(n);
  };
  document.getElementById("prev")!.addEventListener("click", () => go(index - 1));
  document.getElementById("next")!.addEventListener("click", () => go(index + 1));
  document.getElementById("picker")!.addEventListener("change", (e) => go(Number((e.target as HTMLSelectElement).value)));

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
      saveGrades();
      // Update selection highlight and total without a full re-render so focus stays put.
      const row = input.closest("tr")!;
      row.querySelectorAll<HTMLButtonElement>(".sg-band").forEach((b) => b.classList.toggle("is-selected", Number(b.dataset.bandPoints) === g.points[critId]));
      const t = Object.values(g.points).reduce<number>((acc, v) => acc + (v ?? 0), 0);
      app.querySelector("[data-gg-total]")!.textContent = String(t);
    });
  });

  const comment = app.querySelector<HTMLTextAreaElement>("[data-gg-comment]")!;
  comment.addEventListener("input", () => {
    g.comment = comment.value;
    saveGrades();
  });

  document.getElementById("submit")!.addEventListener("click", () => {
    saveGrades();
    const s = document.getElementById("saved")!;
    s.textContent = "Saved";
    setTimeout(() => (s.textContent = ""), 1500);
  });
}

window.addEventListener("hashchange", render);
if (!location.hash) location.hash = "1";
render();
