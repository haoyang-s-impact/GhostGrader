import type { Decision, DriftAlert } from "./schemas";

/** Key for an override: order-independent pair of decision ids. */
export function overrideKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

/** Grades within this much of each other are treated as consistent. */
export function driftThreshold(maxPoints: number): number {
  return Math.max(1.5, 0.1 * maxPoints);
}

/** Tag used so two complete responses can still be compared with each other. */
export const COMPLETE_TAG = "complete_response";

function conceptsOf(d: Decision): string[] {
  return d.missingConcepts.length === 0 ? [COMPLETE_TAG] : d.missingConcepts;
}

export function roundHalf(n: number): number {
  return Math.round(n * 2) / 2;
}

/**
 * Compare the current grade against earlier grades in the same session.
 * Two decisions are comparable when they share a missing concept (or are
 * both complete) and both have an AI suggestion. The comparison is on the
 * offset from the suggestion, so "you were 2 points lenient with Ada for
 * the same gap but 4 points strict here" is what gets flagged.
 * Deterministic; no model call.
 */
export function detectDrift(current: Decision, history: Decision[], overrides: ReadonlySet<string> = new Set()): DriftAlert | null {
  if (current.suggestedPoints === null) return null;
  const threshold = driftThreshold(current.maxPoints);
  const currentOffset = current.points - current.suggestedPoints;
  const mine = conceptsOf(current);
  let best: DriftAlert | null = null;

  // Only the latest grade per prior submission counts: re-grading replaces.
  const latestBySubmission = new Map<string, Decision>();
  for (const d of history) {
    if (d.submissionId === current.submissionId || d.assignmentId !== current.assignmentId) continue;
    const prev = latestBySubmission.get(d.submissionId);
    if (!prev || d.at > prev.at) latestBySubmission.set(d.submissionId, d);
  }

  for (const prior of latestBySubmission.values()) {
    if (prior.suggestedPoints === null) continue;
    if (overrides.has(overrideKey(current.id, prior.id))) continue;
    const shared = conceptsOf(prior).filter((c) => mine.includes(c));
    if (shared.length === 0) continue;
    const priorOffset = prior.points - prior.suggestedPoints;
    const spread = Math.abs(currentOffset - priorOffset);
    if (spread < threshold) continue;
    if (!best || spread > best.spread) {
      best = {
        currentDecisionId: current.id,
        priorDecisionId: prior.id,
        currentSubmissionIndex: current.submissionIndex,
        priorSubmissionIndex: prior.submissionIndex,
        priorStudentName: prior.studentName,
        sharedConcepts: shared,
        currentPoints: current.points,
        priorPoints: prior.points,
        currentSuggested: current.suggestedPoints,
        priorSuggested: prior.suggestedPoints,
        currentOffset,
        priorOffset,
        spread,
        recommendedPoints: Math.max(0, Math.min(current.maxPoints, roundHalf(current.suggestedPoints + priorOffset))),
        maxPoints: current.maxPoints,
      };
    }
  }
  return best;
}
