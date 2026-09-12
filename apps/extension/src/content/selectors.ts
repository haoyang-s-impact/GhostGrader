/**
 * Every DOM lookup lives here. Swapping the mock SpeedGrader for real Canvas
 * means rewriting this file and nothing else.
 */
export interface PageRubricRow {
  criterionId: string;
  title: string;
  maxPoints: number;
  points: number | null;
  input: HTMLInputElement;
}

export interface PageSubmission {
  assignmentId: string;
  submissionId: string;
  submissionIndex: number;
  studentName: string;
  text: string;
  rubric: PageRubricRow[];
}

export function readSubmission(root: ParentNode = document): PageSubmission | null {
  const main = root.querySelector<HTMLElement>("[data-gg-submission-id]");
  const essay = root.querySelector<HTMLElement>("[data-gg-essay]");
  const header = root.querySelector<HTMLElement>("[data-gg-assignment-id]");
  if (!main || !essay || !header) return null;
  const submissionId = main.dataset.ggSubmissionId;
  const submissionIndex = Number(main.dataset.ggSubmissionIndex);
  const assignmentId = header.dataset.ggAssignmentId;
  if (!submissionId || !assignmentId || !Number.isFinite(submissionIndex)) return null;

  const rubric: PageRubricRow[] = [];
  for (const row of root.querySelectorAll<HTMLElement>("[data-gg-criterion-id]")) {
    const input = row.querySelector<HTMLInputElement>("[data-gg-points]");
    const criterionId = row.dataset.ggCriterionId;
    if (!input || !criterionId) continue;
    rubric.push({
      criterionId,
      title: row.querySelector("[data-gg-criterion-title]")?.textContent?.trim() ?? criterionId,
      maxPoints: Number(row.dataset.ggCriterionMax ?? input.max ?? 0),
      points: parsePoints(input.value),
      input,
    });
  }
  return {
    assignmentId,
    submissionId,
    submissionIndex,
    studentName: root.querySelector("[data-gg-student-name]")?.textContent?.trim() ?? "Student",
    text: essay.textContent ?? "",
    rubric,
  };
}

export function parsePoints(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function pointsInputFor(criterionId: string, root: ParentNode = document): HTMLInputElement | null {
  return root.querySelector<HTMLInputElement>(`[data-gg-criterion-id="${criterionId}"] [data-gg-points]`);
}

export function commentBox(root: ParentNode = document): HTMLTextAreaElement | null {
  return root.querySelector<HTMLTextAreaElement>("[data-gg-comment]");
}

/** Set a form control's value the way a user would, so the page's own listeners fire. */
export function setControlValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

export function criterionIdOfInput(el: EventTarget | null): string | null {
  if (!(el instanceof HTMLInputElement) || !el.hasAttribute("data-gg-points")) return null;
  return el.closest<HTMLElement>("[data-gg-criterion-id]")?.dataset.ggCriterionId ?? null;
}
