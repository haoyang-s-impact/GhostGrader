import { describe, expect, it } from "vitest";
import { COMPLETE_TAG, detectDrift, driftThreshold, overrideKey } from "../src/drift";
import type { Decision } from "../src/schemas";

const MAX = 30;

function d(over: Partial<Decision> & { id: string; submissionIndex: number; points: number; suggestedPoints?: number | null }): Decision {
  return {
    assignmentId: "a",
    submissionId: `sub-${over.submissionIndex}`,
    studentName: `Student ${over.submissionIndex}`,
    maxPoints: MAX,
    suggestedPoints: 20,
    missingConcepts: ["reversibility"],
    at: over.submissionIndex,
    ...over,
  };
}

describe("driftThreshold", () => {
  it("is 1.5 for small scales and 10% for large ones", () => {
    expect(driftThreshold(5)).toBe(1.5);
    expect(driftThreshold(30)).toBe(3);
    expect(driftThreshold(100)).toBe(10);
  });
});

describe("detectDrift", () => {
  it("flags the demo scenario: same omission, lenient on #4, strict on #11", () => {
    const prior = d({ id: "d4", submissionIndex: 4, points: 23, suggestedPoints: 20 }); // +3
    const current = d({ id: "d11", submissionIndex: 11, points: 15, suggestedPoints: 20 }); // -5
    const alert = detectDrift(current, [prior])!;
    expect(alert).toMatchObject({
      priorSubmissionIndex: 4,
      priorStudentName: "Student 4",
      sharedConcepts: ["reversibility"],
      currentOffset: -5,
      priorOffset: 3,
      spread: 8,
      recommendedPoints: 23,
      maxPoints: MAX,
    });
  });

  it("stays quiet when both grades sit similarly relative to the suggestion", () => {
    const prior = d({ id: "d4", submissionIndex: 4, points: 18, suggestedPoints: 20 });
    const current = d({ id: "d11", submissionIndex: 11, points: 22, suggestedPoints: 24 });
    expect(detectDrift(current, [prior])).toBeNull();
  });

  it("compares two complete responses with each other", () => {
    const prior = d({ id: "d1", submissionIndex: 1, points: 30, suggestedPoints: 30, missingConcepts: [] });
    const current = d({ id: "d2", submissionIndex: 2, points: 24, suggestedPoints: 30, missingConcepts: [] });
    expect(detectDrift(current, [prior])!.sharedConcepts).toEqual([COMPLETE_TAG]);
  });

  it("ignores prior decisions with different gaps", () => {
    const prior = d({ id: "d4", submissionIndex: 4, points: 28, suggestedPoints: 20, missingConcepts: ["quantitative_reference"] });
    const current = d({ id: "d11", submissionIndex: 11, points: 15, suggestedPoints: 20 });
    expect(detectDrift(current, [prior])).toBeNull();
  });

  it("needs a suggestion on both sides", () => {
    const prior = d({ id: "d4", submissionIndex: 4, points: 28, suggestedPoints: null });
    const current = d({ id: "d11", submissionIndex: 11, points: 15, suggestedPoints: 20 });
    expect(detectDrift(current, [prior])).toBeNull();
    expect(detectDrift(d({ id: "x", submissionIndex: 12, points: 1, suggestedPoints: null }), [d({ id: "d4", submissionIndex: 4, points: 28 })])).toBeNull();
  });

  it("uses only the latest re-grade of a prior submission", () => {
    const first = d({ id: "d4a", submissionIndex: 4, points: 30, at: 1 });
    const rescored = d({ id: "d4b", submissionIndex: 4, points: 20, at: 2 });
    const current = d({ id: "d11", submissionIndex: 11, points: 20, at: 3 });
    expect(detectDrift(current, [first, rescored])).toBeNull();
  });

  it("does not compare a submission with its own earlier decisions", () => {
    const earlier = d({ id: "d11", submissionIndex: 11, points: 30, at: 1 });
    const current = d({ id: "d11", submissionIndex: 11, points: 10, at: 2 });
    expect(detectDrift(current, [earlier])).toBeNull();
  });

  it("respects overrides and clamps the recommendation to the scale", () => {
    const prior = d({ id: "d4", submissionIndex: 4, points: 30, suggestedPoints: 20 }); // +10
    const current = d({ id: "d11", submissionIndex: 11, points: 20, suggestedPoints: 28 });
    expect(detectDrift(current, [prior], new Set([overrideKey("d11", "d4")]))).toBeNull();
    expect(detectDrift(current, [prior])!.recommendedPoints).toBe(30);
  });

  it("picks the most divergent prior when several match", () => {
    const a = d({ id: "d2", submissionIndex: 2, points: 24 });
    const b = d({ id: "d4", submissionIndex: 4, points: 28 });
    const current = d({ id: "d11", submissionIndex: 11, points: 15 });
    expect(detectDrift(current, [a, b])!.priorSubmissionIndex).toBe(4);
  });
});
