import type { Assignment, Criterion, ModelOutput, AnalysisResult, CriterionAnalysis, ScoreCheck } from "./schemas";
import { driftThreshold } from "./drift";

/** Points for a band level; falls back to the closest-named band, then the lowest band. */
export function bandPoints(criterion: Criterion, level: string): number {
  const exact = criterion.bands.find((b) => b.level === level);
  if (exact) return exact.points;
  const loose = criterion.bands.find((b) => b.level.toLowerCase() === level.toLowerCase());
  if (loose) return loose.points;
  return Math.min(...criterion.bands.map((b) => b.points));
}

export function bandDescriptor(criterion: Criterion, level: string): string {
  return criterion.bands.find((b) => b.level.toLowerCase() === level.toLowerCase())?.descriptor ?? "";
}

/**
 * Turn raw model output into a full AnalysisResult: one entry per rubric
 * criterion in rubric order, with suggestedPoints derived from the rubric.
 * Criteria the model skipped get the lowest band with zero confidence so the
 * teacher sees the gap instead of a silent omission.
 */
export function finalizeAnalysis(submissionId: string, assignment: Assignment, output: ModelOutput): AnalysisResult {
  const criteria: CriterionAnalysis[] = assignment.rubric.criteria.map((c) => {
    const m = output.criteria.find((x) => x.criterionId === c.id);
    const level = m?.level ?? c.bands[c.bands.length - 1]?.level ?? "Beginning";
    return {
      criterionId: c.id,
      level,
      evidence: m?.evidence ?? [],
      missingConcepts: (m?.missingConcepts ?? []).filter((t) => c.concepts.includes(t)),
      confidence: m?.confidence ?? 0,
      suggestedPoints: bandPoints(c, level),
      bandDescriptor: bandDescriptor(c, level),
    };
  });
  return { submissionId, criteria, feedbackDraft: output.feedbackDraft };
}

/**
 * Compare the teacher's entered points against the rubric-bound analysis.
 * Same threshold as drift so the two interventions feel consistent.
 */
export function checkScore(criterion: Pick<Criterion, "id" | "maxPoints">, analysis: CriterionAnalysis, enteredPoints: number): ScoreCheck | null {
  const diff = enteredPoints - analysis.suggestedPoints;
  if (Math.abs(diff) < driftThreshold(criterion)) return null;
  return {
    criterionId: criterion.id,
    enteredPoints,
    suggestedPoints: analysis.suggestedPoints,
    suggestedLevel: analysis.level,
    bandDescriptor: analysis.bandDescriptor,
    missingConcepts: analysis.missingConcepts,
    evidence: analysis.evidence,
    diff,
  };
}
