import { describe, expect, it } from "vitest";
import { answers, assignment, groundTruth, mockAnalyze, type Decision } from "@gg/shared";
import { buildDecision, decisionId, latestByAnswer, type GradingTarget } from "../src/grading/decisions";

const q1 = assignment.questions[0]!;
const sub11 = answers.find((a) => a.id === "sub-11")!;
const target: GradingTarget = { assignmentId: assignment.id, questionId: q1.id, answer: sub11, maxPoints: 30 };

describe("buildDecision", () => {
  it("carries the suggestion, missing concepts, comment and student from this answer", () => {
    const analysis = mockAnalyze(sub11, assignment, q1, groundTruth);
    const d = buildDecision(target, 16, "Explain reversibility.", analysis, 5)!;
    expect(d).toMatchObject({
      id: "sub-11:grade",
      questionId: "q-haber-1",
      answerId: "sub-11",
      studentId: "stu-11",
      studentIndex: 11,
      studentName: "Kavya Sharma",
      points: 16,
      maxPoints: 30,
      suggestedPoints: 20.5,
      comment: "Explain reversibility.",
      at: 5,
    });
    expect(d.missingConcepts).toContain("reversibility");
  });

  it("records no suggestion when the analysis is not ready, or belongs to another answer", () => {
    expect(buildDecision(target, 16, "", null)!.suggestedPoints).toBeNull();
    const other = mockAnalyze(answers.find((a) => a.id === "sub-04")!, assignment, q1, groundTruth);
    const d = buildDecision(target, 16, "", other)!;
    expect(d.suggestedPoints).toBeNull();
    expect(d.missingConcepts).toEqual([]);
  });

  it("refuses without a grade scale", () => {
    expect(buildDecision({ ...target, maxPoints: 0 }, 16, "", null)).toBeNull();
  });

  it("uses a deterministic id per answer", () => {
    expect(decisionId("sub-11")).toBe("sub-11:grade");
  });
});

describe("latestByAnswer", () => {
  it("keeps the newest decision per answer", () => {
    const d = (answerId: string, points: number, at: number) => ({ ...buildDecision({ ...target, answer: { ...sub11, id: answerId } }, points, "", null, at)! }) as Decision;
    const m = latestByAnswer([d("a", 1, 1), d("a", 2, 3), d("b", 5, 2)]);
    expect(m.get("a")?.points).toBe(2);
    expect(m.get("b")?.points).toBe(5);
  });
});
