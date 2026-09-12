import { criterionIdOfInput, parsePoints, readSubmission, type PageSubmission } from "./selectors";

export interface ObserverHandlers {
  onSubmissionChanged: (s: PageSubmission) => void;
  onSubmissionMissing: () => void;
  onPointsChanged: (criterionId: string, points: number | null) => void;
}

export const POINTS_DEBOUNCE_MS = 400;

/**
 * Watches the grading page. Submission changes are detected by diffing the
 * submission id after each DOM mutation; point edits are captured by a
 * delegated input listener so they survive the page re-rendering its rubric.
 */
export function startObserver(h: ObserverHandlers, root: Document = document): () => void {
  let lastId: string | null = null;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

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
    const critId = criterionIdOfInput(e.target);
    if (!critId) return;
    const value = parsePoints((e.target as HTMLInputElement).value);
    const existing = timers.get(critId);
    if (existing) clearTimeout(existing);
    timers.set(
      critId,
      setTimeout(() => {
        timers.delete(critId);
        h.onPointsChanged(critId, value);
      }, POINTS_DEBOUNCE_MS),
    );
  };
  root.addEventListener("input", onInput, true);

  check();
  return () => {
    mo.disconnect();
    root.removeEventListener("input", onInput, true);
    for (const t of timers.values()) clearTimeout(t);
  };
}
