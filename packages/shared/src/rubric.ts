import type { Assignment, Criterion, ModelOutput, AnalysisResult, CriterionAnalysis, ScoreCheck } from "./schemas";
import { driftThreshold, roundHalf } from "./drift";

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

export function rubricMax(assignment: Pick<Assignment, "rubric">): number {
  return assignment.rubric.criteria.reduce((acc, c) => acc + c.maxPoints, 0);
}

/** The scale the single grade is on. */
export function gradeMax(assignment: Pick<Assignment, "rubric" | "totalPoints">): number {
  return assignment.totalPoints ?? rubricMax(assignment);
}

/** Convert rubric points to the assignment's grade scale, to the nearest half point. */
export function scaleToGrade(assignment: Pick<Assignment, "rubric" | "totalPoints">, rubricPoints: number): number {
  const rm = rubricMax(assignment);
  if (rm === 0) return 0;
  return roundHalf((rubricPoints / rm) * gradeMax(assignment));
}

/**
 * Turn raw model output into a full AnalysisResult: one entry per rubric
 * criterion in rubric order, suggestedPoints derived from the rubric, and a
 * single suggested grade on the assignment's scale. Criteria the model
 * skipped get the lowest band with zero confidence so the teacher sees the
 * gap instead of a silent omission.
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
      maxPoints: c.maxPoints,
    };
  });
  const rubricPoints = criteria.reduce((acc, c) => acc + c.suggestedPoints, 0);
  return {
    submissionId,
    criteria,
    suggestedTotal: scaleToGrade(assignment, rubricPoints),
    maxTotal: gradeMax(assignment),
    missingConcepts: [...new Set(criteria.flatMap((c) => c.missingConcepts))],
    summary: output.summary,
    feedbackDraft: output.feedbackDraft,
  };
}

/**
 * Compare the teacher's single grade against the rubric-bound suggestion.
 * Same threshold as drift so the two interventions feel consistent.
 */
export function checkScore(analysis: AnalysisResult, enteredPoints: number): ScoreCheck | null {
  const diff = enteredPoints - analysis.suggestedTotal;
  if (Math.abs(diff) < driftThreshold(analysis.maxTotal)) return null;
  return {
    enteredPoints,
    suggestedPoints: analysis.suggestedTotal,
    maxPoints: analysis.maxTotal,
    diff,
    summary: analysis.summary,
    missingConcepts: analysis.missingConcepts,
    breakdown: analysis.criteria.map((c) => ({
      criterionId: c.criterionId,
      level: c.level,
      suggestedPoints: c.suggestedPoints,
      maxPoints: c.maxPoints,
      missingConcepts: c.missingConcepts,
    })),
  };
}
