import { describe, expect, it } from "vitest";
import { detectDrift, driftThreshold, overrideKey } from "../src/drift";
import type { Decision } from "../src/schemas";

const crit = { maxPoints: 5 };

function d(over: Partial<Decision> & { id: string; submissionIndex: number; deduction: number }): Decision {
  return {
    assignmentId: "a",
    submissionId: `sub-${over.submissionIndex}`,
    criterionId: "reversibility",
    points: crit.maxPoints - over.deduction,
    missingConcepts: ["reversibility"],
    at: over.submissionIndex,
    ...over,
  };
}

describe("driftThreshold", () => {
  it("is 1.5 for a 5-point criterion and scales for large criteria", () => {
    expect(driftThreshold({ maxPoints: 5 })).toBe(1.5);
    expect(driftThreshold({ maxPoints: 20 })).toBe(4);
  });
});

describe("detectDrift", () => {
  it("flags the demo scenario: -2.5 on #4, -5 on #11, same omission", () => {
    const prior = d({ id: "d4", submissionIndex: 4, deduction: 2.5 });
    const current = d({ id: "d11", submissionIndex: 11, deduction: 5 });
    const alert = detectDrift(current, [prior], crit);
    expect(alert).not.toBeNull();
    expect(alert!.priorSubmissionIndex).toBe(4);
    expect(alert!.sharedConcept).toBe("reversibility");
    expect(alert!.spread).toBe(2.5);
    expect(alert!.priorPoints).toBe(2.5);
  });

  it("stays quiet when the spread is below threshold", () => {
    const prior = d({ id: "d4", submissionIndex: 4, deduction: 2.5 });
    const current = d({ id: "d11", submissionIndex: 11, deduction: 3.5 });
    expect(detectDrift(current, [prior], crit)).toBeNull();
  });

  it("ignores prior decisions with a different missing concept", () => {
    const prior = d({ id: "d4", submissionIndex: 4, deduction: 0, missingConcepts: ["dynamic_equilibrium"] });
    const current = d({ id: "d11", submissionIndex: 11, deduction: 5 });
    expect(detectDrift(current, [prior], crit)).toBeNull();
  });

  it("ignores prior decisions on a different criterion", () => {
    const prior = d({ id: "d4", submissionIndex: 4, deduction: 0, criterionId: "clarity" });
    const current = d({ id: "d11", submissionIndex: 11, deduction: 5 });
    expect(detectDrift(current, [prior], crit)).toBeNull();
  });

  it("returns null when the current decision has no missing concepts", () => {
    const prior = d({ id: "d4", submissionIndex: 4, deduction: 5 });
    const current = d({ id: "d11", submissionIndex: 11, deduction: 0, missingConcepts: [] });
    expect(detectDrift(current, [prior], crit)).toBeNull();
  });

  it("uses only the latest re-score of a prior submission", () => {
    const first = d({ id: "d4a", submissionIndex: 4, deduction: 5, at: 1 });
    const rescored = d({ id: "d4b", submissionIndex: 4, deduction: 4.5, at: 2 });
    const current = d({ id: "d11", submissionIndex: 11, deduction: 5, at: 3 });
    expect(detectDrift(current, [first, rescored], crit)).toBeNull();
  });

  it("does not compare a submission with its own earlier decisions", () => {
    const earlier = d({ id: "d11a", submissionIndex: 11, deduction: 0, at: 1 });
    const current = d({ id: "d11b", submissionIndex: 11, deduction: 5, at: 2 });
    expect(detectDrift(current, [earlier], crit)).toBeNull();
  });

  it("respects overrides for a specific pair", () => {
    const prior = d({ id: "d4", submissionIndex: 4, deduction: 2.5 });
    const current = d({ id: "d11", submissionIndex: 11, deduction: 5 });
    const overrides = new Set([overrideKey("d11", "d4")]);
    expect(detectDrift(current, [prior], crit, overrides)).toBeNull();
  });

  it("picks the most divergent prior when several match", () => {
    const a = d({ id: "d2", submissionIndex: 2, deduction: 3 });
    const b = d({ id: "d4", submissionIndex: 4, deduction: 1 });
    const current = d({ id: "d11", submissionIndex: 11, deduction: 5 });
    expect(detectDrift(current, [a, b], crit)!.priorSubmissionIndex).toBe(4);
  });
});
