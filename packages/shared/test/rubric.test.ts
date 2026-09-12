import { describe, expect, it } from "vitest";
import { assignment, criterionById, groundTruth, submissions } from "../src/data";
import { mockAnalyze } from "../src/mock-analyzer";
import { bandPoints, checkScore, finalizeAnalysis } from "../src/rubric";

const rev = criterionById("reversibility");

describe("bandPoints", () => {
  it("maps levels to rubric points, case-insensitively, with a safe fallback", () => {
    expect(bandPoints(rev, "Exemplary")).toBe(5);
    expect(bandPoints(rev, "beginning")).toBe(0);
    expect(bandPoints(rev, "Nonsense")).toBe(0);
  });
});

describe("finalizeAnalysis", () => {
  it("stamps suggestedPoints and fills criteria the model skipped", () => {
    const r = finalizeAnalysis("sub-x", assignment, {
      criteria: [{ criterionId: "reversibility", level: "Proficient", evidence: [], missingConcepts: ["forward_reverse_rates", "not_a_tag"], confidence: 0.7 }],
      feedbackDraft: "hi",
    });
    expect(r.criteria).toHaveLength(6);
    const first = r.criteria[0]!;
    expect(first.suggestedPoints).toBe(3.5);
    expect(first.missingConcepts).toEqual(["forward_reverse_rates"]);
    const skipped = r.criteria[1]!;
    expect(skipped.confidence).toBe(0);
    expect(skipped.suggestedPoints).toBe(0);
  });
});

describe("checkScore", () => {
  const sub4 = submissions.find((s) => s.index === 4)!;
  const analysis = mockAnalyze(sub4, assignment, groundTruth).criteria.find((c) => c.criterionId === "reversibility")!;

  it("flags a score far above the rubric band the analysis chose", () => {
    const check = checkScore(rev, analysis, 5)!;
    expect(check).toMatchObject({ suggestedPoints: 0, suggestedLevel: "Beginning", enteredPoints: 5, diff: 5 });
    expect(check.missingConcepts).toContain("reversibility");
    expect(check.bandDescriptor.length).toBeGreaterThan(10);
  });

  it("stays quiet within the threshold", () => {
    expect(checkScore(rev, analysis, 1)).toBeNull();
    expect(checkScore(rev, analysis, 0)).toBeNull();
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
  });
});
