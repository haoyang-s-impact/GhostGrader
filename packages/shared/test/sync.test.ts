import { describe, expect, it } from "vitest";
import { decisionReference, latestDecisions, pendingPush, pushReference, syncSummary } from "../src/sync";
import type { Decision, PushRecord } from "../src/schemas";

const decision = (answerId: string, points: number, at: number, comment = ""): Decision => ({
  id: `${answerId}:grade`,
  assignmentId: "a",
  questionId: "q1",
  answerId,
  studentId: `stu-${answerId}`,
  studentIndex: 1,
  studentName: "",
  points,
  maxPoints: 30,
  suggestedPoints: null,
  missingConcepts: [],
  comment,
  at,
});

const push = (answerId: string, points: number, status: PushRecord["status"] = "pushed", comment = ""): PushRecord => ({
  answerId,
  questionId: "q1",
  studentId: `stu-${answerId}`,
  points,
  clientReferenceId: pushReference(answerId, points, comment),
  status,
  lmsGradeId: status === "pushed" ? `g-${answerId}` : "",
  pushedAt: status === "pushed" ? 1 : 0,
  error: status === "failed" ? "boom" : "",
});

describe("pushReference", () => {
  it("is content-addressed on answer, points and comment", () => {
    expect(pushReference("sub-04", 20.5)).toBe("sub-04:20.5");
    expect(pushReference("sub-04", 20.5, "Good")).toBe(pushReference("sub-04", 20.5, "Good"));
    expect(pushReference("sub-04", 20.5)).not.toBe(pushReference("sub-04", 21));
    expect(pushReference("sub-04", 20.5, "Good")).not.toBe(pushReference("sub-04", 20.5, "Good."));
  });

  it("matches the reference derived from a decision", () => {
    expect(decisionReference(decision("x", 12, 1, "Nice"))).toBe(pushReference("x", 12, "Nice"));
  });
});

describe("latestDecisions", () => {
  it("keeps only the newest decision per answer", () => {
    const got = latestDecisions([decision("x", 10, 1), decision("x", 12, 3), decision("y", 5, 2)]);
    expect(got.map((d) => [d.answerId, d.points]).sort()).toEqual([["x", 12], ["y", 5]]);
  });
});

describe("pendingPush", () => {
  it("treats every grade as pending before anything is pushed", () => {
    expect(pendingPush([decision("x", 10, 1), decision("y", 5, 2)], [])).toHaveLength(2);
  });

  it("does not re-send a grade the LMS already has", () => {
    expect(pendingPush([decision("x", 10, 1)], [push("x", 10)])).toEqual([]);
  });

  it("puts a re-graded answer back in the queue", () => {
    const got = pendingPush([decision("x", 10, 1), decision("x", 14, 2)], [push("x", 10)]);
    expect(got.map((d) => d.points)).toEqual([14]);
  });

  it("re-sends a grade changed back to a value that was delivered once before", () => {
    // Pushed 20, then 23; the LMS now holds 23. Re-grading to 20 must push again.
    const decisions = [decision("x", 20, 3)];
    expect(pendingPush(decisions, [push("x", 20), push("x", 23)]).map((d) => d.points)).toEqual([20]);
  });

  it("re-sends when only the feedback changed", () => {
    expect(pendingPush([decision("x", 10, 1, "Great work.")], [push("x", 10, "pushed", "Great wrok.")])).toHaveLength(1);
  });

  it("retries a push that failed", () => {
    expect(pendingPush([decision("x", 10, 1)], [push("x", 10, "failed")])).toHaveLength(1);
  });
});

describe("syncSummary", () => {
  it("counts graded, pushed, pending and failed", () => {
    const decisions = [decision("x", 10, 1), decision("y", 5, 2), decision("z", 7, 3)];
    const pushes = [push("x", 10), push("y", 5, "failed")];
    expect(syncSummary(decisions, pushes)).toEqual({ graded: 3, pushed: 1, pending: 2, failed: 1 });
  });
});
