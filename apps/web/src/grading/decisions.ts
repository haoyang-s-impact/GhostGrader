import type { AnalysisResult, Answer, Decision } from "@gg/shared";

/** The answer being graded, with what the grading UI needs to know about it. */
export interface GradingTarget {
  assignmentId: string;
  questionId: string;
  answer: Answer;
  /** The scale this question's grade is on. */
  maxPoints: number;
}

/** Deterministic id per answer: re-grading replaces, and overrides stay stable. */
export function decisionId(answerId: string): string {
  return `${answerId}:grade`;
}

export function buildDecision(target: GradingTarget, points: number, comment: string, analysis: AnalysisResult | null, now: number = Date.now()): Decision | null {
  if (!(target.maxPoints > 0)) return null;
  const a = target.answer;
  return {
    id: decisionId(a.id),
    assignmentId: target.assignmentId,
    questionId: target.questionId,
    answerId: a.id,
    studentId: a.studentId,
    studentIndex: a.studentIndex,
    studentName: a.studentName,
    points,
    maxPoints: target.maxPoints,
    // Only an analysis of this very answer counts as its suggestion.
    suggestedPoints: analysis && analysis.answerId === a.id ? analysis.suggestedTotal : null,
    missingConcepts: analysis && analysis.answerId === a.id ? analysis.missingConcepts : [],
    comment,
    at: now,
  };
}

/** The latest decision for each answer. */
export function latestByAnswer(decisions: Decision[]): Map<string, Decision> {
  const m = new Map<string, Decision>();
  for (const d of decisions) {
    const prev = m.get(d.answerId);
    if (!prev || d.at > prev.at) m.set(d.answerId, d);
  }
  return m;
}
