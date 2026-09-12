import type { Band, Assignment, Criterion, Decision, ModelOutput, AnalysisResult, CriterionAnalysis, Question, ScoreCheck } from "./schemas";
import { driftThreshold, roundHalf } from "./drift";

/**
 * Find the band the model meant. Models return the level name most of the
 * time, but also "5" for a band called "Score 5", "score 5", or the points
 * alone. Falls back to the lowest band only when nothing matches.
 */
export function findBand(criterion: Criterion, level: string): Band | undefined {
  const wanted = level.trim();
  const lower = wanted.toLowerCase();
  const exact = criterion.bands.find((b) => b.level === wanted) ?? criterion.bands.find((b) => b.level.toLowerCase() === lower);
  if (exact) return exact;
  const asNumber = Number(wanted.replace(",", "."));
  if (wanted !== "" && Number.isFinite(asNumber)) {
    const byPoints = criterion.bands.find((b) => b.points === asNumber);
    if (byPoints) return byPoints;
  }
  const digits = wanted.match(/-?\d+(?:[.,]\d+)?/)?.[0];
  if (digits) {
    const n = Number(digits.replace(",", "."));
    const byNumberInName = criterion.bands.find((b) => b.level.match(/-?\d+(?:[.,]\d+)?/)?.[0] !== undefined && Number(b.level.match(/-?\d+(?:[.,]\d+)?/)![0]!.replace(",", ".")) === n);
    if (byNumberInName) return byNumberInName;
  }
  return undefined;
}

/** Points for a band level; see findBand for the matching rules. Unknown level: the lowest band. */
export function bandPoints(criterion: Criterion, level: string): number {
  const band = findBand(criterion, level);
  if (band) return band.points;
  return Math.min(...criterion.bands.map((b) => b.points));
}

export function bandDescriptor(criterion: Criterion, level: string): string {
  return findBand(criterion, level)?.descriptor ?? "";
}

export function rubricMax(question: Pick<Question, "rubric">): number {
  return question.rubric.criteria.reduce((acc, c) => acc + c.maxPoints, 0);
}

/** The scale one question's grade is on. */
export function questionMax(question: Pick<Question, "rubric" | "totalPoints">): number {
  return question.totalPoints ?? rubricMax(question);
}

/** The scale an assignment's rolled-up grade is on: the sum of its questions. */
export function assignmentMax(assignment: Pick<Assignment, "questions">): number {
  return assignment.questions.reduce((acc, q) => acc + questionMax(q), 0);
}

export function questionById(assignment: Pick<Assignment, "questions">, questionId: string): Question | undefined {
  return assignment.questions.find((q) => q.id === questionId);
}

/** Convert rubric points to the question's grade scale, to the nearest half point. */
export function scaleToGrade(question: Pick<Question, "rubric" | "totalPoints">, rubricPoints: number): number {
  const rm = rubricMax(question);
  if (rm === 0) return 0;
  return roundHalf((rubricPoints / rm) * questionMax(question));
}

/**
 * Turn raw model output into a full AnalysisResult: one entry per rubric
 * criterion in rubric order, suggestedPoints derived from the rubric, and a
 * single suggested grade on the question's scale. Criteria the model
 * skipped get the lowest band with zero confidence so the teacher sees the
 * gap instead of a silent omission.
 */
export function finalizeAnalysis(answerId: string, question: Question, output: ModelOutput): AnalysisResult {
  const criteria: CriterionAnalysis[] = question.rubric.criteria.map((c) => {
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
    answerId,
    questionId: question.id,
    criteria,
    suggestedTotal: scaleToGrade(question, rubricPoints),
    maxTotal: questionMax(question),
    missingConcepts: [...new Set(criteria.flatMap((c) => c.missingConcepts))],
    summary: output.summary,
    feedbackDraft: output.feedbackDraft,
  };
}

/**
 * Compare the teacher's grade for one answer against the rubric-bound
 * suggestion for that same answer. Same threshold as drift so the two
 * interventions feel consistent.
 */
export function checkScore(analysis: AnalysisResult, enteredPoints: number): ScoreCheck | null {
  const diff = enteredPoints - analysis.suggestedTotal;
  if (Math.abs(diff) < driftThreshold(analysis.maxTotal)) return null;
  return {
    questionId: analysis.questionId,
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

export interface AssignmentGrade {
  studentId: string;
  studentName: string;
  studentIndex: number;
  /** Sum of this student's latest grade on each question. */
  points: number;
  /** Always the full assignment scale, even when grading is partial; see `complete`. */
  maxPoints: number;
  gradedQuestions: number;
  totalQuestions: number;
  complete: boolean;
  perQuestion: { questionId: string; points: number | null; maxPoints: number }[];
}

/**
 * Roll one student's per-question grades up to an assignment grade. Computed,
 * never stored, so it cannot drift from the decisions it is built from.
 */
export function rollUp(
  assignment: Pick<Assignment, "id" | "questions">,
  student: { id: string; name: string; index: number },
  decisions: Decision[],
): AssignmentGrade {
  const mine = latestPerQuestion(decisions.filter((d) => d.assignmentId === assignment.id && d.studentId === student.id));
  const perQuestion = assignment.questions.map((q) => ({
    questionId: q.id,
    points: mine.get(q.id)?.points ?? null,
    maxPoints: questionMax(q),
  }));
  const graded = perQuestion.filter((q) => q.points !== null);
  return {
    studentId: student.id,
    studentName: student.name,
    studentIndex: student.index,
    points: graded.reduce((acc, q) => acc + (q.points ?? 0), 0),
    maxPoints: assignmentMax(assignment),
    gradedQuestions: graded.length,
    totalQuestions: assignment.questions.length,
    complete: graded.length === assignment.questions.length,
    perQuestion,
  };
}

function latestPerQuestion(decisions: Decision[]): Map<string, Decision> {
  const out = new Map<string, Decision>();
  for (const d of decisions) {
    const prev = out.get(d.questionId);
    if (!prev || d.at > prev.at) out.set(d.questionId, d);
  }
  return out;
}
