import type { Assignment, AssignmentInput, Criterion } from "@gg/shared";
import { lms } from "../api";
import { esc, go, slug } from "../util";
import { bindHeader, renderHeader } from "./header";

/**
 * Canvas-style rubric builder. A teacher defines criteria, each with point
 * bands and the concept tags the AI is allowed to report as missing. This is
 * the whole contract the grader is bound to for that assignment.
 */
export async function rubricEditorView(app: HTMLElement, params: { assignmentId?: string; courseId?: string }) {
  const teachers = await lms.teachers();
  const existing = params.assignmentId ? await lms.assignment(params.assignmentId) : null;
  const courses = await lms.courses();
  const courseId = existing?.courseId ?? params.courseId ?? courses[0]?.id ?? "";

  let draft: AssignmentInput = existing
    ? { courseId: existing.courseId, title: existing.title, prompt: existing.prompt, learningObjectives: existing.learningObjectives, rubric: existing.rubric, anchors: existing.anchors, totalPoints: existing.totalPoints }
    : {
        courseId,
        title: "",
        prompt: "",
        learningObjectives: [],
        anchors: [],
        rubric: { id: `rubric-${Date.now().toString(36)}`, criteria: [blankCriterion(1)] },
      };

  function render() {
    app.innerHTML = `
      ${renderHeader(teachers, `<a href="#/courses">Dashboard</a> › ${existing ? esc(existing.title) : "New assignment"} › <strong>Rubric</strong>`)}
      <main class="sg-page sg-editor">
        <h1>${existing ? "Edit assignment and rubric" : "New assignment"}</h1>
        <p class="sg-help">Ghost Grader is bound to exactly what you define here. Concept tags are the only things the AI may report as missing for a criterion.</p>
        <div id="editor-error" class="sg-error" hidden></div>

        <section class="sg-card">
          <h2>Assignment</h2>
          <label class="sg-field">Course
            <select id="f-course" class="sg-select">${courses.map((c) => `<option value="${c.id}" ${c.id === draft.courseId ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>
          </label>
          <label class="sg-field">Title <input id="f-title" class="sg-input" value="${esc(draft.title)}" placeholder="e.g. Causes of the First World War" /></label>
          <label class="sg-field">Prompt given to students <textarea id="f-prompt" class="sg-textarea" rows="3" placeholder="The question students answer">${esc(draft.prompt)}</textarea></label>
          <label class="sg-field">Learning objectives, one per line <textarea id="f-objectives" class="sg-textarea" rows="2">${esc(draft.learningObjectives.join("\n"))}</textarea></label>
          <label class="sg-field">Grade out of <input id="f-total" class="sg-input sg-input-xs" type="number" min="1" step="0.5" value="${draft.totalPoints ?? ""}" placeholder="${draft.rubric.criteria.reduce((a, c) => a + c.maxPoints, 0) || ""}" />
            <span class="sg-help sg-help-inline">Leave blank to grade out of the rubric total. Students get one grade; the rubric stays behind the scenes for the AI.</span>
          </label>
        </section>

        <section class="sg-card">
          <div class="sg-card-head"><h2>Criteria</h2><button class="sg-btn sg-btn-sm" id="add-criterion" type="button">+ Add criterion</button></div>
          <div id="criteria">
            ${draft.rubric.criteria.map((c, i) => criterionEditor(c, i)).join("")}
          </div>
        </section>

        <section class="sg-card">
          <h2>Anchor responses <span class="sg-muted">(optional)</span></h2>
          <p class="sg-help">Example answers at known quality levels. They help the AI calibrate to your standard.</p>
          <div id="anchors">
            ${draft.anchors.map((a, i) => `<div class="sg-anchor" data-i="${i}"><input class="sg-input" data-anchor-label value="${esc(a.label)}" placeholder="Label, e.g. Exemplary anchor" /><textarea class="sg-textarea" data-anchor-text rows="3">${esc(a.text)}</textarea><button class="sg-btn sg-btn-sm" type="button" data-remove-anchor>Remove</button></div>`).join("")}
          </div>
          <button class="sg-btn sg-btn-sm" id="add-anchor" type="button">+ Add anchor</button>
        </section>

        <div class="sg-actions sg-sticky">
          <button class="sg-btn sg-btn-primary" id="save" type="button" data-save-rubric>${existing ? "Save changes" : "Create assignment"}</button>
          <a href="#/courses" class="sg-btn">Cancel</a>
          <span id="save-status" class="sg-saved"></span>
        </div>
      </main>`;
    bindHeader();
    bind();
  }

  function criterionEditor(c: Criterion, i: number): string {
    return `<div class="sg-criterion" data-i="${i}" data-criterion-editor>
      <div class="sg-criterion-head">
        <input class="sg-input" data-c-title value="${esc(c.title)}" placeholder="Criterion title" />
        <label class="sg-field-inline">Max pts <input class="sg-input sg-input-xs" type="number" min="1" step="0.5" data-c-max value="${c.maxPoints}" /></label>
        <button class="sg-btn sg-btn-sm" type="button" data-remove-criterion title="Remove criterion">✕</button>
      </div>
      <textarea class="sg-textarea" data-c-desc rows="2" placeholder="What this criterion rewards">${esc(c.description)}</textarea>
      <label class="sg-field">Concept tags the AI may report as missing (comma separated, snake_case)
        <input class="sg-input" data-c-concepts value="${esc(c.concepts.join(", "))}" placeholder="e.g. thesis_statement, counterargument" />
      </label>
      <table class="sg-bands-table">
        <thead><tr><th>Level</th><th>Points</th><th>Descriptor</th><th></th></tr></thead>
        <tbody>
          ${c.bands.map((b, j) => `<tr data-j="${j}"><td><input class="sg-input sg-input-sm" data-b-level value="${esc(b.level)}" /></td><td><input class="sg-input sg-input-xs" type="number" step="0.5" min="0" data-b-points value="${b.points}" /></td><td><input class="sg-input" data-b-desc value="${esc(b.descriptor)}" placeholder="What earns this band" /></td><td><button class="sg-btn sg-btn-sm" type="button" data-remove-band>✕</button></td></tr>`).join("")}
        </tbody>
      </table>
      <button class="sg-btn sg-btn-sm" type="button" data-add-band>+ Add band</button>
    </div>`;
  }

  /** Read the DOM back into the draft. Ids for new criteria derive from their titles. */
  function collect(): AssignmentInput {
    const courseSel = document.getElementById("f-course") as HTMLSelectElement;
    const criteria: Criterion[] = [...document.querySelectorAll<HTMLElement>("[data-criterion-editor]")].map((el, i) => {
      const title = (el.querySelector("[data-c-title]") as HTMLInputElement).value.trim();
      const prev = draft.rubric.criteria[i];
      const id = prev && prev.title === title && prev.id ? prev.id : slug(title || `criterion_${i + 1}`);
      return {
        id,
        title,
        description: (el.querySelector("[data-c-desc]") as HTMLTextAreaElement).value.trim(),
        maxPoints: Number((el.querySelector("[data-c-max]") as HTMLInputElement).value) || 0,
        concepts: (el.querySelector("[data-c-concepts]") as HTMLInputElement).value.split(",").map((s) => slug(s.trim())).filter((s) => s && s !== "criterion"),
        bands: [...el.querySelectorAll<HTMLTableRowElement>("tbody tr")].map((tr) => ({
          level: (tr.querySelector("[data-b-level]") as HTMLInputElement).value.trim(),
          points: Number((tr.querySelector("[data-b-points]") as HTMLInputElement).value) || 0,
          descriptor: (tr.querySelector("[data-b-desc]") as HTMLInputElement).value.trim(),
        })),
      };
    });
    const anchors = [...document.querySelectorAll<HTMLElement>(".sg-anchor")]
      .map((el) => ({
        label: (el.querySelector("[data-anchor-label]") as HTMLInputElement).value.trim(),
        text: (el.querySelector("[data-anchor-text]") as HTMLTextAreaElement).value.trim(),
      }))
      .filter((a) => a.text);
    const totalRaw = (document.getElementById("f-total") as HTMLInputElement).value.trim();
    return {
      courseId: courseSel.value,
      totalPoints: totalRaw === "" ? undefined : Number(totalRaw),
      title: (document.getElementById("f-title") as HTMLInputElement).value.trim(),
      prompt: (document.getElementById("f-prompt") as HTMLTextAreaElement).value.trim(),
      learningObjectives: (document.getElementById("f-objectives") as HTMLTextAreaElement).value.split("\n").map((s) => s.trim()).filter(Boolean),
      rubric: { id: draft.rubric.id, criteria },
      anchors,
    };
  }

  function bind() {
    const mutate = (fn: (d: AssignmentInput) => void) => {
      draft = collect();
      fn(draft);
      render();
    };
    const idxOf = (el: HTMLElement, attr: string) => Number(el.closest<HTMLElement>(`[${attr}]`)!.dataset[attr === "data-i" ? "i" : "j"]);

    document.getElementById("add-criterion")!.addEventListener("click", () => mutate((d) => d.rubric.criteria.push(blankCriterion(d.rubric.criteria.length + 1))));
    document.getElementById("add-anchor")!.addEventListener("click", () => mutate((d) => d.anchors.push({ label: "", text: "" })));
    app.querySelectorAll<HTMLElement>("[data-remove-criterion]").forEach((b) => b.addEventListener("click", () => mutate((d) => d.rubric.criteria.splice(idxOf(b, "data-i"), 1))));
    app.querySelectorAll<HTMLElement>("[data-add-band]").forEach((b) => b.addEventListener("click", () => mutate((d) => d.rubric.criteria[idxOf(b, "data-i")]!.bands.push({ level: "", points: 0, descriptor: "" }))));
    app.querySelectorAll<HTMLElement>("[data-remove-band]").forEach((b) =>
      b.addEventListener("click", () => mutate((d) => d.rubric.criteria[idxOf(b, "data-i")]!.bands.splice(idxOf(b, "data-j"), 1))),
    );
    app.querySelectorAll<HTMLElement>("[data-remove-anchor]").forEach((b) => b.addEventListener("click", () => mutate((d) => d.anchors.splice(idxOf(b, "data-i"), 1))));

    document.getElementById("save")!.addEventListener("click", async () => {
      const err = document.getElementById("editor-error")!;
      const status = document.getElementById("save-status")!;
      err.hidden = true;
      const input = collect();
      const local = validateLocally(input);
      if (local) {
        err.textContent = local;
        err.hidden = false;
        return;
      }
      try {
        const saved: Assignment = existing ? await lms.updateAssignment(existing.id, input) : await lms.createAssignment(input);
        status.textContent = "Saved";
        go(`#/grade/${saved.id}/1`);
      } catch (e) {
        err.textContent = e instanceof Error ? e.message : "Could not save.";
        err.hidden = false;
      }
    });
  }

  render();
}

function blankCriterion(n: number): Criterion {
  return {
    id: `criterion_${n}`,
    title: "",
    description: "",
    maxPoints: 5,
    concepts: [],
    bands: [
      { level: "Exemplary", points: 5, descriptor: "" },
      { level: "Proficient", points: 3.5, descriptor: "" },
      { level: "Developing", points: 2, descriptor: "" },
      { level: "Beginning", points: 0, descriptor: "" },
    ],
  };
}

function validateLocally(a: AssignmentInput): string | null {
  if (!a.title) return "Give the assignment a title.";
  if (!a.prompt) return "Add the prompt students answer.";
  if (a.rubric.criteria.length === 0) return "Add at least one criterion.";
  if (a.totalPoints !== undefined && !(a.totalPoints > 0)) return "Grade out of must be a positive number.";
  for (const c of a.rubric.criteria) {
    if (!c.title) return "Every criterion needs a title.";
    if (c.maxPoints <= 0) return `"${c.title}" needs a positive max score.`;
    if (c.bands.length < 2) return `"${c.title}" needs at least two bands.`;
    if (c.bands.some((b) => !b.level)) return `"${c.title}" has a band without a level name.`;
    if (!c.bands.some((b) => b.points === c.maxPoints)) return `"${c.title}" needs a band worth the full ${c.maxPoints} points.`;
    if (c.bands.some((b) => b.points > c.maxPoints || b.points < 0)) return `"${c.title}" has a band outside 0..${c.maxPoints}.`;
    if (c.concepts.length === 0) return `"${c.title}" needs at least one concept tag so the AI can explain what is missing.`;
  }
  return null;
}
