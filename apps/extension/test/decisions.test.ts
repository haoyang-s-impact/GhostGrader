import { describe, expect, it } from "vitest";
import type { AnalysisResult } from "@gg/shared";
import { buildDecision, decisionId } from "../src/content/decisions";
import { parsePoints, type PageSubmission } from "../src/content/selectors";

const page: PageSubmission = {
  assignmentId: "chem-haber-eq",
  teacherId: "t-demo",
  totalSubmissions: 15,
  submissionId: "sub-11",
  submissionIndex: 11,
  studentName: "Kavya Sharma",
  text: "…",
  rubric: [
    { criterionId: "reversibility", title: "Reversibility", maxPoints: 5, points: null, input: {} as HTMLInputElement },
    { criterionId: "clarity", title: "Clarity", maxPoints: 5, points: 3.5, input: {} as HTMLInputElement },
  ],
};

const analysis: AnalysisResult = {
  submissionId: "sub-11",
  feedbackDraft: "Kavya, …",
  criteria: [
    { criterionId: "reversibility", level: "Beginning", evidence: [], missingConcepts: ["reversibility", "dynamic_equilibrium"], confidence: 0.9, suggestedPoints: 0, bandDescriptor: "" },
    { criterionId: "clarity", level: "Proficient", evidence: [], missingConcepts: [], confidence: 0.8, suggestedPoints: 3.5, bandDescriptor: "" },
  ],
};

describe("buildDecision", () => {
  it("carries the analysis's missing concepts and computes the deduction", () => {
    const d = buildDecision(page, "reversibility", 0, analysis, 123)!;
    expect(d).toMatchObject({
      id: "sub-11:reversibility",
      submissionIndex: 11,
      points: 0,
      deduction: 5,
      missingConcepts: ["reversibility", "dynamic_equilibrium"],
      at: 123,
    });
  });

  it("falls back to no concepts when analysis is not ready", () => {
    const d = buildDecision(page, "reversibility", 2.5, null)!;
    expect(d.missingConcepts).toEqual([]);
    expect(d.deduction).toBe(2.5);
  });

  it("never produces a negative deduction and rejects unknown criteria", () => {
    expect(buildDecision(page, "clarity", 7, analysis)!.deduction).toBe(0);
    expect(buildDecision(page, "nope", 1, analysis)).toBeNull();
  });

  it("uses a deterministic id so re-scoring replaces and overrides stay stable", () => {
    expect(decisionId("sub-04", "reversibility")).toBe("sub-04:reversibility");
  });
});

describe("parsePoints", () => {
  it("parses numbers and treats blanks or junk as null", () => {
    expect(parsePoints("2.5")).toBe(2.5);
    expect(parsePoints(" 0 ")).toBe(0);
    expect(parsePoints("")).toBeNull();
    expect(parsePoints("abc")).toBeNull();
  });
});
