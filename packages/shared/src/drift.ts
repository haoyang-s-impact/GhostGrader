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
 * Compare the current grade against earlier grades given to other students
 * on the same question. Two decisions are comparable when they answer the
 * same question, share a missing concept (or are both complete), and both
 * have an AI suggestion. Scoping to one question matters: concept tags and
 * the offset scale are rubric-scoped, so a shared tag across two different
 * questions is a coincidence of vocabulary, not the same gap. The comparison is on the
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

  // Only the latest grade per other student on this question counts: re-grading replaces.
  const latestByStudent = new Map<string, Decision>();
  for (const d of history) {
    if (d.assignmentId !== current.assignmentId || d.questionId !== current.questionId) continue;
    if (d.studentId === current.studentId) continue;
    const prev = latestByStudent.get(d.studentId);
    if (!prev || d.at > prev.at) latestByStudent.set(d.studentId, d);
  }

  for (const prior of latestByStudent.values()) {
    if (prior.suggestedPoints === null) continue;
    if (overrides.has(overrideKey(current.id, prior.id))) continue;
    const shared = conceptsOf(prior).filter((c) => mine.includes(c));
    if (shared.length === 0) continue;
    const priorOffset = prior.points - prior.suggestedPoints;
    const spread = Math.abs(currentOffset - priorOffset);
    if (spread < threshold) continue;
    if (!best || spread > best.spread) {
      best = {
        questionId: current.questionId,
        currentDecisionId: current.id,
        priorDecisionId: prior.id,
        currentStudentIndex: current.studentIndex,
        priorStudentIndex: prior.studentIndex,
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
