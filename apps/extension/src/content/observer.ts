import { isGradeInput, parsePoints, readSubmission, type PageSubmission } from "./selectors";

export interface ObserverHandlers {
  onSubmissionChanged: (s: PageSubmission) => void;
  onSubmissionMissing: () => void;
  onGradeChanged: (points: number | null) => void;
}

export const POINTS_DEBOUNCE_MS = 400;

/**
 * Watches the grading page. Submission changes are detected by diffing the
 * submission id after each DOM mutation; grade edits are captured by a
 * delegated input listener so they survive the page re-rendering.
 */
export function startObserver(h: ObserverHandlers, root: Document = document): () => void {
  let lastId: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const check = () => {
    const s = readSubmission(root);
    if (!s) {
      if (lastId !== null) {
        lastId = null;
        h.onSubmissionMissing();
      }
      return;
    }
    if (s.submissionId !== lastId) {
      lastId = s.submissionId;
      h.onSubmissionChanged(s);
    }
  };

  const mo = new MutationObserver(() => queueMicrotask(check));
  mo.observe(root.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-gg-submission-id"] });

  const onInput = (e: Event) => {
    if (!isGradeInput(e.target)) return;
    const value = parsePoints(e.target.value);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      h.onGradeChanged(value);
    }, POINTS_DEBOUNCE_MS);
  };
  root.addEventListener("input", onInput, true);

  check();
  return () => {
    mo.disconnect();
    root.removeEventListener("input", onInput, true);
    if (timer) clearTimeout(timer);
  };
}
