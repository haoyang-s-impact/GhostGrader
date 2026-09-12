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
  grade: null,
  maxPoints: 30,
};

const analysis: AnalysisResult = {
  submissionId: "sub-11",
  suggestedTotal: 20.5,
  maxTotal: 30,
  missingConcepts: ["reversibility", "dynamic_equilibrium"],
  summary: "Missing reversibility.",
  feedbackDraft: "Kavya, …",
  criteria: [],
};

describe("buildDecision", () => {
  it("carries the analysis's suggestion and missing concepts", () => {
    const d = buildDecision(page, 16, analysis, 123)!;
    expect(d).toMatchObject({
      id: "sub-11:grade",
      submissionIndex: 11,
      studentName: "Kavya Sharma",
      points: 16,
      maxPoints: 30,
      suggestedPoints: 20.5,
      missingConcepts: ["reversibility", "dynamic_equilibrium"],
      at: 123,
    });
  });

  it("records a null suggestion when analysis is not ready", () => {
    const d = buildDecision(page, 25, null)!;
    expect(d.suggestedPoints).toBeNull();
    expect(d.missingConcepts).toEqual([]);
  });

  it("refuses to build a decision without a grade scale", () => {
    expect(buildDecision({ ...page, maxPoints: 0 }, 1, analysis)).toBeNull();
  });

  it("uses a deterministic id so re-grading replaces and overrides stay stable", () => {
    expect(decisionId("sub-04")).toBe("sub-04:grade");
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
