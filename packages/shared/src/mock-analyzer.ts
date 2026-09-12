import type { AnalysisResult, Answer, Assignment, GroundTruth, Question } from "./schemas";
import { finalizeAnalysis } from "./rubric";

/**
 * Deterministic stand-in for the Claude analysis call. Used when no API key is
 * configured and in tests. Produces the same shape the model is asked for.
 * Only the seeded question has ground truth (keyed by answer id); every other
 * question falls back to a heuristic keyword scan so the demo still works offline.
 */
export function mockAnalyze(answer: Answer, assignment: Assignment, question: Question, truth: GroundTruth): AnalysisResult {
  const gt = truth[answer.id];
  const firstName = answer.studentName.split(" ")[0] ?? "there";
  if (gt) {
    const feedbackDraft =
      `${firstName}, ${gt.strength} ` +
      `To strengthen this response, ${gt.improvement} ` +
      `Keep building on the reasoning you have already shown.`;
    const missing = gt.criteria.flatMap((c) => c.missingConcepts.map((t) => t.replace(/_/g, " ")));
    const summary = missing.length
      ? `Strong in places, but the rubric penalizes the missing ${[...new Set(missing)].slice(0, 3).join(", ")}.`
      : "Meets every criterion at the top band.";
    return finalizeAnalysis(answer.id, question, {
      criteria: question.rubric.criteria.map((c) => {
        const g = gt.criteria.find((x) => x.criterionId === c.id);
        return {
          criterionId: c.id,
          level: g?.level ?? "Proficient",
          evidence: g?.evidence ?? [],
          missingConcepts: g?.missingConcepts ?? [],
          confidence: 0.9,
        };
      }),
      summary,
      feedbackDraft,
    });
  }
  return heuristicAnalyze(answer, assignment, question, firstName);
}

/** Crude stem so "reversibility" matches "reversible" and "equilibrium" matches "equilibria". */
function stem(word: string): string {
  return word.length >= 6 ? word.slice(0, 6) : word;
}

/** Keyword heuristic for questions without ground truth: a concept counts as present if its words appear. */
function heuristicAnalyze(answer: Answer, assignment: Assignment, question: Question, firstName: string): AnalysisResult {
  const text = answer.text.toLowerCase();
  const sentences = answer.text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
  const missingAll: string[] = [];
  const criteria = question.rubric.criteria.map((c) => {
    const present: string[] = [];
    const missing: string[] = [];
    for (const tag of c.concepts) {
      const stems = tag.split("_").filter((w) => w.length > 2).map(stem);
      const hit = stems.length > 0 && stems.every((w) => text.includes(w));
      (hit ? present : missing).push(tag);
    }
    const ratio = c.concepts.length === 0 ? 1 : present.length / c.concepts.length;
    const sorted = [...c.bands].sort((a, b) => b.points - a.points);
    const idx = Math.min(sorted.length - 1, Math.round((1 - ratio) * (sorted.length - 1)));
    const level = sorted[idx]?.level ?? sorted[0]?.level ?? "Proficient";
    const evidence = sentences.filter((s) => present.some((tag) => tag.split("_").some((w) => w.length > 2 && s.toLowerCase().includes(stem(w))))).slice(0, 2);
    missingAll.push(...missing.map((t) => t.replace(/_/g, " ")));
    return { criterionId: c.id, level, evidence, missingConcepts: missing, confidence: 0.5 };
  });
  const feedbackDraft =
    `${firstName}, thank you for a thoughtful response to "${assignment.title}". ` +
    (missingAll.length
      ? `To strengthen it, address ${missingAll.slice(0, 2).join(" and ")} explicitly, as the assignment asks. `
      : `You addressed the key ideas the assignment asks for. `) +
    `Keep building on the reasoning you have already shown.`;
  const summary = missingAll.length ? `Keyword scan: missing ${[...new Set(missingAll)].slice(0, 3).join(", ")}.` : "Keyword scan: all concept tags present.";
  return finalizeAnalysis(answer.id, question, { criteria, summary, feedbackDraft });
}
