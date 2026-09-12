import type { AnalysisResult, Assignment, GroundTruth, Submission } from "./schemas";

/**
 * Deterministic stand-in for the Claude analysis call. Used when no API key is
 * configured and in tests. Produces the same shape the model is asked for.
 */
export function mockAnalyze(
  submission: Submission,
  assignment: Assignment,
  truth: GroundTruth,
): AnalysisResult {
  const gt = truth[submission.id];
  if (!gt) throw new Error(`No ground truth for ${submission.id}`);
  const firstName = submission.studentName.split(" ")[0] ?? "there";
  const feedbackDraft =
    `${firstName}, ${gt.strength} ` +
    `To strengthen this response, ${gt.improvement} ` +
    `Keep building on the reasoning you have already shown.`;
  return {
    submissionId: submission.id,
    criteria: assignment.rubric.criteria.map((c) => {
      const g = gt.criteria.find((x) => x.criterionId === c.id);
      return {
        criterionId: c.id,
        level: g?.level ?? "Proficient",
        evidence: g?.evidence ?? [],
        missingConcepts: g?.missingConcepts ?? [],
        confidence: 0.9,
      };
    }),
    feedbackDraft,
  };
}
