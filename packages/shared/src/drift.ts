import type { Criterion, Decision, DriftAlert } from "./schemas";

/** Key for an override: order-independent pair of decision ids. */
export function overrideKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

export function driftThreshold(criterion: Pick<Criterion, "maxPoints">): number {
  return Math.max(1.5, 0.2 * criterion.maxPoints);
}

/**
 * Compare the current decision against earlier decisions in the same session.
 * Returns the most divergent prior decision for the same criterion that shares
 * a missing-concept tag, if the deduction spread exceeds the threshold.
 * Deterministic; no model call.
 */
export function detectDrift(
  current: Decision,
  history: Decision[],
  criterion: Pick<Criterion, "maxPoints">,
  overrides: ReadonlySet<string> = new Set(),
): DriftAlert | null {
  if (current.missingConcepts.length === 0) return null;
  const threshold = driftThreshold(criterion);
  let best: DriftAlert | null = null;

  // Only the latest decision per prior submission counts: re-scoring replaces.
  const latestBySubmission = new Map<string, Decision>();
  for (const d of history) {
    if (d.criterionId !== current.criterionId) continue;
    if (d.submissionId === current.submissionId) continue;
    const prev = latestBySubmission.get(d.submissionId);
    if (!prev || d.at > prev.at) latestBySubmission.set(d.submissionId, d);
  }

  for (const prior of latestBySubmission.values()) {
    if (overrides.has(overrideKey(current.id, prior.id))) continue;
    const shared = prior.missingConcepts.find((c) => current.missingConcepts.includes(c));
    if (!shared) continue;
    const spread = Math.abs(current.deduction - prior.deduction);
    if (spread < threshold) continue;
    if (!best || spread > best.spread) {
      best = {
        currentDecisionId: current.id,
        priorDecisionId: prior.id,
        currentSubmissionIndex: current.submissionIndex,
        priorSubmissionIndex: prior.submissionIndex,
        criterionId: current.criterionId,
        sharedConcept: shared,
        currentDeduction: current.deduction,
        priorDeduction: prior.deduction,
        priorPoints: prior.points,
        spread,
      };
    }
  }
  return best;
}
