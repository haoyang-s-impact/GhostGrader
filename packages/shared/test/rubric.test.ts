import { describe, expect, it } from "vitest";
import { answers, assignment, criterionById, groundTruth } from "../src/data";
import { mockAnalyze } from "../src/mock-analyzer";
import { assignmentMax, bandPoints, checkScore, finalizeAnalysis, questionById, questionMax, rollUp, scaleToGrade } from "../src/rubric";
import type { Answer, Decision } from "../src/schemas";

const rev = criterionById("reversibility");
const q1 = assignment.questions[0]!;
const q2 = assignment.questions[1]!;
const answer = (id: string): Answer => answers.find((a) => a.id === id)!;
const analyzeQ1 = (id: string) => mockAnalyze(answer(id), assignment, q1, groundTruth);

describe("bandPoints with drafted band names", () => {
  const crit = { id: "c", title: "c", description: "", maxPoints: 10, concepts: ["x"], bands: [
    { level: "Score 10", points: 10, descriptor: "both" },
    { level: "Score 5", points: 5, descriptor: "one" },
    { level: "Score 0", points: 0, descriptor: "none" },
  ] };
  it("matches the model's bare number, the points value, and case-insensitive names", () => {
    expect(bandPoints(crit, "5")).toBe(5);
    expect(bandPoints(crit, "10")).toBe(10);
    expect(bandPoints(crit, "score 5")).toBe(5);
    expect(bandPoints(crit, "Score 0")).toBe(0);
    expect(bandPoints(crit, "Level 5")).toBe(5);
    expect(bandPoints(crit, "Nonsense")).toBe(0);
  });
});

describe("bandPoints", () => {
  it("maps levels to rubric points, case-insensitively, with a safe fallback", () => {
    expect(bandPoints(rev, "Exemplary")).toBe(5);
    expect(bandPoints(rev, "beginning")).toBe(0);
    expect(bandPoints(rev, "Nonsense")).toBe(0);
  });
});

describe("grade scale", () => {
  it("defaults each question to its rubric sum and scales to totalPoints when set", () => {
    expect(questionMax(q1)).toBe(30);
    expect(questionMax(q2)).toBe(15);
    expect(scaleToGrade(q1, 15)).toBe(15);
    const hundred = { ...q1, totalPoints: 100 };
    expect(questionMax(hundred)).toBe(100);
    expect(scaleToGrade(hundred, 15)).toBe(50);
    expect(scaleToGrade(hundred, 20)).toBe(66.5);
  });

  it("puts the assignment on the sum of its question scales", () => {
    expect(assignmentMax(assignment)).toBe(45);
  });

  it("finds questions by id", () => {
    expect(questionById(assignment, "q-haber-2")?.title).toBe("Pressure and yield");
    expect(questionById(assignment, "nope")).toBeUndefined();
  });
});

describe("finalizeAnalysis", () => {
  it("stamps ids, suggested points and a suggested total, and fills criteria the model skipped", () => {
    const r = finalizeAnalysis("sub-x", q1, {
      criteria: [{ criterionId: "reversibility", level: "Proficient", evidence: [], missingConcepts: ["forward_reverse_rates", "not_a_tag"], confidence: 0.7 }],
      summary: "s",
      feedbackDraft: "hi",
    });
    expect(r.answerId).toBe("sub-x");
    expect(r.questionId).toBe("q-haber-1");
    expect(r.criteria).toHaveLength(6);
    expect(r.criteria[0]!.suggestedPoints).toBe(3.5);
    expect(r.criteria[0]!.missingConcepts).toEqual(["forward_reverse_rates"]);
    expect(r.criteria[1]!.confidence).toBe(0);
    expect(r.suggestedTotal).toBe(3.5);
    expect(r.maxTotal).toBe(30);
    expect(r.missingConcepts).toEqual(["forward_reverse_rates"]);
  });

  it("filters missing concepts to the question's own vocabulary", () => {
    // quantitative_reference is valid on q2's evidence criterion, but reversibility is not in q2 at all.
    const r = finalizeAnalysis("q2-x", q2, {
      criteria: [{ criterionId: "q2_evidence", level: "Developing", evidence: [], missingConcepts: ["quantitative_reference", "reversibility"], confidence: 0.6 }],
      summary: "s",
      feedbackDraft: "hi",
    });
    expect(r.missingConcepts).toEqual(["quantitative_reference"]);
    expect(r.maxTotal).toBe(15);
  });
});

describe("mockAnalyze on the seeded essays", () => {
  it("suggests full marks for the exemplary essay and a low grade for the weakest", () => {
    const top = analyzeQ1("sub-15");
    const low = analyzeQ1("sub-14");
    expect(top.suggestedTotal).toBe(30);
    expect(top.missingConcepts).toEqual([]);
    expect(low.suggestedTotal).toBeLessThan(12);
    expect(low.missingConcepts).toContain("reversibility");
  });

  it("gives answers 4 and 11 the same suggestion since they share the same gap", () => {
    const a = analyzeQ1("sub-04");
    const b = analyzeQ1("sub-11");
    expect(a.suggestedTotal).toBe(b.suggestedTotal);
    expect(a.suggestedTotal).toBe(20.5);
  });
});

describe("checkScore", () => {
  const analysis = analyzeQ1("sub-04");

  it("flags a grade far from the rubric-derived suggestion with a per-criterion breakdown", () => {
    const check = checkScore(analysis, 28)!;
    expect(check).toMatchObject({ questionId: "q-haber-1", enteredPoints: 28, suggestedPoints: 20.5, maxPoints: 30, diff: 7.5 });
    expect(check.missingConcepts).toContain("reversibility");
    expect(check.breakdown).toHaveLength(6);
    expect(check.breakdown[0]).toMatchObject({ criterionId: "reversibility", level: "Beginning", suggestedPoints: 0, maxPoints: 5 });
  });

  it("stays quiet within the threshold", () => {
    expect(checkScore(analysis, 22)).toBeNull();
    expect(checkScore(analysis, 19)).toBeNull();
  });
});

describe("mockAnalyze heuristic fallback", () => {
  it("analyzes a question without ground truth", () => {
    const pat: Answer = { ...answer("sub-01"), id: "s-new", studentName: "Pat Doe", text: "The reaction is reversible and reaches a dynamic equilibrium." };
    const r = mockAnalyze(pat, { ...assignment, title: "Custom" }, q1, groundTruth);
    expect(r.criteria).toHaveLength(6);
    expect(r.feedbackDraft.startsWith("Pat,")).toBe(true);
    const revC = r.criteria.find((c) => c.criterionId === "reversibility")!;
    expect(revC.missingConcepts).not.toContain("reversibility");
    expect(revC.evidence.length).toBeGreaterThan(0);
    expect(r.summary).toMatch(/Keyword scan/);
  });

  it("grades the seeded question 2 answers apart: the thorough answer beats the vague one", () => {
    const strong = mockAnalyze(answer("q2-sub-01"), assignment, q2, groundTruth);
    const vague = mockAnalyze(answer("q2-sub-07"), assignment, q2, groundTruth);
    expect(strong.suggestedTotal).toBeGreaterThan(vague.suggestedTotal);
    expect(vague.missingConcepts).toContain("moles_of_gas");
  });
});

describe("rollUp", () => {
  const student = { id: "stu-04", name: "Daniel Okafor", index: 4 };
  const grade = (questionId: string, points: number, at: number): Decision => ({
    id: `${questionId}:${at}`,
    assignmentId: assignment.id,
    questionId,
    answerId: `${questionId}-ans`,
    studentId: student.id,
    studentIndex: 4,
    studentName: student.name,
    points,
    maxPoints: questionId === q1.id ? 30 : 15,
    suggestedPoints: null,
    missingConcepts: [],
    comment: "",
    at,
  });

  it("reports nothing graded for a student with no decisions", () => {
    const r = rollUp(assignment, student, []);
    expect(r).toMatchObject({ points: 0, maxPoints: 45, gradedQuestions: 0, totalQuestions: 2, complete: false });
  });

  it("keeps the full assignment scale while grading is partial", () => {
    const r = rollUp(assignment, student, [grade(q1.id, 20, 1)]);
    expect(r).toMatchObject({ points: 20, maxPoints: 45, gradedQuestions: 1, complete: false });
    expect(r.perQuestion).toEqual([
      { questionId: q1.id, points: 20, maxPoints: 30 },
      { questionId: q2.id, points: null, maxPoints: 15 },
    ]);
  });

  it("sums the latest grade on every question once all are graded", () => {
    const r = rollUp(assignment, student, [grade(q1.id, 20, 1), grade(q2.id, 9, 2), grade(q1.id, 24, 3)]);
    expect(r).toMatchObject({ points: 33, maxPoints: 45, gradedQuestions: 2, complete: true });
  });

  it("ignores other students' decisions", () => {
    const other = { ...grade(q1.id, 30, 1), studentId: "stu-01" };
    expect(rollUp(assignment, student, [other]).gradedQuestions).toBe(0);
  });
});
