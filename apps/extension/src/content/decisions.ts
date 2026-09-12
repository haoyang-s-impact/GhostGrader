import type { AnalysisResult, Decision } from "@gg/shared";
import type { PageSubmission } from "./selectors";

/** Deterministic id per (submission, criterion): re-scoring replaces, and overrides stay stable. */
export function decisionId(submissionId: string, criterionId: string): string {
  return `${submissionId}:${criterionId}`;
}

export function buildDecision(
  page: PageSubmission,
  criterionId: string,
  points: number,
  analysis: AnalysisResult | null,
  now: number = Date.now(),
): Decision | null {
  const row = page.rubric.find((r) => r.criterionId === criterionId);
  if (!row) return null;
  const missingConcepts = analysis?.criteria.find((c) => c.criterionId === criterionId)?.missingConcepts ?? [];
  return {
    id: decisionId(page.submissionId, criterionId),
    assignmentId: page.assignmentId,
    submissionId: page.submissionId,
    submissionIndex: page.submissionIndex,
    criterionId,
    points,
    deduction: Math.max(0, row.maxPoints - points),
    missingConcepts,
    at: now,
  };
}
