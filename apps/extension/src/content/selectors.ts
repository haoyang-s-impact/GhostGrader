/**
 * Every DOM lookup lives here. Swapping the mock SpeedGrader for real Canvas
 * means rewriting this file and nothing else.
 */
export interface PageSubmission {
  assignmentId: string;
  teacherId: string | null;
  totalSubmissions: number;
  submissionId: string;
  submissionIndex: number;
  studentName: string;
  text: string;
  /** The single grade input's current value and scale. */
  grade: number | null;
  maxPoints: number;
  /** The grade the teacher committed with Submit, and when. Null until submitted. */
  submittedPoints: number | null;
  submittedAt: number | null;
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

  const gradeInput = root.querySelector<HTMLInputElement>("[data-gg-grade]");
  // Both halves of the submit marker are read in one pass, so a partially
  // applied pair can never be observed.
  const submittedRaw = main.dataset.ggSubmittedPoints;
  const submittedAtRaw = main.dataset.ggSubmittedAt;
  const submittedPoints = submittedRaw === undefined ? null : parsePoints(submittedRaw);
  const submittedAt = submittedAtRaw === undefined ? null : Number(submittedAtRaw) || 0;
  return {
    assignmentId,
    teacherId: root.querySelector<HTMLElement>("[data-gg-teacher-id]")?.dataset.ggTeacherId ?? null,
    totalSubmissions: Number(main.dataset.ggSubmissionTotal ?? 0) || 0,
    submissionId,
    submissionIndex,
    studentName: root.querySelector("[data-gg-student-name]")?.textContent?.trim() ?? "Student",
    text: essay.textContent ?? "",
    grade: gradeInput ? parsePoints(gradeInput.value) : null,
    maxPoints: Number(gradeInput?.dataset.ggGradeMax ?? gradeInput?.max ?? 0) || 0,
    submittedPoints,
    submittedAt,
  };
}

/**
 * Identity of the current submit. The timestamp is part of it: re-submitting
 * the same number is still a new submit, and points alone would not change.
 */
export function submitMarker(s: PageSubmission): string | null {
  return s.submittedPoints === null ? null : `${s.submittedPoints}@${s.submittedAt}`;
}

export function parsePoints(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function gradeInput(root: ParentNode = document): HTMLInputElement | null {
  return root.querySelector<HTMLInputElement>("[data-gg-grade]");
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

export function isGradeInput(el: EventTarget | null): el is HTMLInputElement {
  return el instanceof HTMLInputElement && el.hasAttribute("data-gg-grade");
}
