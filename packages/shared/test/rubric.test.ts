import { describe, expect, it } from "vitest";
import { assignment, criterionById, groundTruth, submissions } from "../src/data";
import { mockAnalyze } from "../src/mock-analyzer";
import { bandPoints, checkScore, finalizeAnalysis, gradeMax, scaleToGrade } from "../src/rubric";

const rev = criterionById("reversibility");

describe("bandPoints", () => {
  it("maps levels to rubric points, case-insensitively, with a safe fallback", () => {
    expect(bandPoints(rev, "Exemplary")).toBe(5);
    expect(bandPoints(rev, "beginning")).toBe(0);
    expect(bandPoints(rev, "Nonsense")).toBe(0);
  });
});

describe("grade scale", () => {
  it("defaults to the rubric sum and scales to totalPoints when set", () => {
    expect(gradeMax(assignment)).toBe(30);
    expect(scaleToGrade(assignment, 15)).toBe(15);
    const hundred = { ...assignment, totalPoints: 100 };
    expect(gradeMax(hundred)).toBe(100);
    expect(scaleToGrade(hundred, 15)).toBe(50);
    expect(scaleToGrade(hundred, 20)).toBe(66.5);
  });
});

describe("finalizeAnalysis", () => {
  it("stamps suggested points, a suggested total, and fills criteria the model skipped", () => {
    const r = finalizeAnalysis("sub-x", assignment, {
      criteria: [{ criterionId: "reversibility", level: "Proficient", evidence: [], missingConcepts: ["forward_reverse_rates", "not_a_tag"], confidence: 0.7 }],
      summary: "s",
      feedbackDraft: "hi",
    });
    expect(r.criteria).toHaveLength(6);
    expect(r.criteria[0]!.suggestedPoints).toBe(3.5);
    expect(r.criteria[0]!.missingConcepts).toEqual(["forward_reverse_rates"]);
    expect(r.criteria[1]!.confidence).toBe(0);
    expect(r.suggestedTotal).toBe(3.5);
    expect(r.maxTotal).toBe(30);
    expect(r.missingConcepts).toEqual(["forward_reverse_rates"]);
  });
});

describe("mockAnalyze on the seeded essays", () => {
  it("suggests full marks for the exemplary essay and a low grade for the weakest", () => {
    const top = mockAnalyze(submissions.find((s) => s.index === 15)!, assignment, groundTruth);
    const low = mockAnalyze(submissions.find((s) => s.index === 14)!, assignment, groundTruth);
    expect(top.suggestedTotal).toBe(30);
    expect(top.missingConcepts).toEqual([]);
    expect(low.suggestedTotal).toBeLessThan(12);
    expect(low.missingConcepts).toContain("reversibility");
  });

  it("gives submissions 4 and 11 the same suggestion since they share the same gap", () => {
    const a = mockAnalyze(submissions.find((s) => s.index === 4)!, assignment, groundTruth);
    const b = mockAnalyze(submissions.find((s) => s.index === 11)!, assignment, groundTruth);
    expect(a.suggestedTotal).toBe(b.suggestedTotal);
    expect(a.suggestedTotal).toBe(20.5);
  });
});

describe("checkScore", () => {
  const analysis = mockAnalyze(submissions.find((s) => s.index === 4)!, assignment, groundTruth);

  it("flags a grade far from the rubric-derived suggestion with a per-criterion breakdown", () => {
    const check = checkScore(analysis, 28)!;
    expect(check).toMatchObject({ enteredPoints: 28, suggestedPoints: 20.5, maxPoints: 30, diff: 7.5 });
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
  it("analyzes an unseeded assignment without ground truth", () => {
    const custom = { ...assignment, id: "custom", title: "Custom" };
    const r = mockAnalyze({ id: "s-new", index: 1, studentName: "Pat Doe", text: "The reaction is reversible and reaches a dynamic equilibrium." }, custom, groundTruth);
    expect(r.criteria).toHaveLength(6);
    expect(r.feedbackDraft.startsWith("Pat,")).toBe(true);
    const revC = r.criteria.find((c) => c.criterionId === "reversibility")!;
    expect(revC.missingConcepts).not.toContain("reversibility");
    expect(revC.evidence.length).toBeGreaterThan(0);
    expect(r.summary).toMatch(/Keyword scan/);
  });
});
