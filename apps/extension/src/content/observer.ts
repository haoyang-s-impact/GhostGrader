import { isGradeInput, parsePoints, readSubmission, submitMarker, type PageSubmission } from "./selectors";

export interface ObserverHandlers {
  onSubmissionChanged: (s: PageSubmission) => void;
  onSubmissionMissing: () => void;
  /** The grade in the box changed. A draft: it drives the rubric check only. */
  onGradeTyped: (points: number | null) => void;
  /** The teacher committed a grade with Submit. Only this becomes a decision. */
  onGradeSubmitted: (points: number, at: number) => void;
}

export const POINTS_DEBOUNCE_MS = 400;

/**
 * Watches the grading page. Submission changes are detected by diffing the
 * submission id after each DOM mutation; grade edits are captured by a
 * delegated input listener so they survive the page re-rendering; a commit is
 * detected by diffing the submit marker the page publishes on Submit.
 */
export function startObserver(h: ObserverHandlers, root: Document = document): () => void {
  let lastId: string | null = null;
  let lastMarker: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancelTyped = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const check = () => {
    const s = readSubmission(root);
    if (!s) {
      if (lastId !== null) {
        lastId = null;
        lastMarker = null;
        h.onSubmissionMissing();
      }
      return;
    }
    const marker = submitMarker(s);
    if (s.submissionId !== lastId) {
      lastId = s.submissionId;
      // Baseline the marker without firing: opening a student who was already
      // submitted is not a new submit, and must not re-record a decision.
      lastMarker = marker;
      h.onSubmissionChanged(s);
      return;
    }
    if (marker !== lastMarker) {
      lastMarker = marker;
      if (s.submittedPoints !== null) {
        cancelTyped(); // the committed value wins over a pending keystroke
        h.onGradeSubmitted(s.submittedPoints, s.submittedAt ?? 0);
      }
    }
  };

  const mo = new MutationObserver(() => queueMicrotask(check));
  mo.observe(root.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-gg-submission-id", "data-gg-submitted-points", "data-gg-submitted-at"],
  });

  const onInput = (e: Event) => {
    if (!isGradeInput(e.target)) return;
    const value = parsePoints(e.target.value);
    cancelTyped();
    timer = setTimeout(() => {
      timer = null;
      h.onGradeTyped(value);
    }, POINTS_DEBOUNCE_MS);
  };
  root.addEventListener("input", onInput, true);

  check();
  return () => {
    mo.disconnect();
    root.removeEventListener("input", onInput, true);
    cancelTyped();
  };
}
