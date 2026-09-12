import type { AnalysisResult, Decision } from "@gg/shared";
import type { PageSubmission } from "./selectors";

/** Deterministic id per submission: re-grading replaces, and overrides stay stable. */
export function decisionId(submissionId: string): string {
  return `${submissionId}:grade`;
}

export function buildDecision(page: PageSubmission, points: number, analysis: AnalysisResult | null, now: number = Date.now()): Decision | null {
  if (!(page.maxPoints > 0)) return null;
  return {
    id: decisionId(page.submissionId),
    assignmentId: page.assignmentId,
    submissionId: page.submissionId,
    submissionIndex: page.submissionIndex,
    studentName: page.studentName,
    points,
    maxPoints: page.maxPoints,
    suggestedPoints: analysis ? analysis.suggestedTotal : null,
    missingConcepts: analysis?.missingConcepts ?? [],
    at: now,
  };
}
