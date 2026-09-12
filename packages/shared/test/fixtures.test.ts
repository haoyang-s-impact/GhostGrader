import { describe, expect, it } from "vitest";
import { answers, assignment, criterionById, groundTruth, students } from "../src/data";
import { mockAnalyze } from "../src/mock-analyzer";
import { AnalysisResultSchema, type Question } from "../src/schemas";

const q1 = assignment.questions[0]!;
const q2 = assignment.questions[1]!;
const q1Answers = answers.filter((a) => a.questionId === q1.id);
const q2Answers = answers.filter((a) => a.questionId === q2.id);

describe("seeded dataset", () => {
  it("has two ordered questions, each with its own rubric and closed concept vocabulary", () => {
    expect(assignment.questions.map((q) => q.index)).toEqual([1, 2]);
    expect(q1.rubric.criteria).toHaveLength(6);
    expect(q2.rubric.criteria).toHaveLength(3);
    for (const q of assignment.questions) {
      for (const c of q.rubric.criteria) {
        expect(c.concepts.length).toBeGreaterThan(0);
        expect(c.bands[0]!.points).toBe(c.maxPoints);
      }
    }
  });

  it("is linked to the LMS at every level so pushes have somewhere to land", () => {
    expect(assignment.lmsAssignmentId).not.toBe("");
    for (const q of assignment.questions) expect(q.lmsQuestionId).not.toBe("");
    for (const a of answers) expect(a.lmsAnswerId).not.toBe("");
  });

  it("has a fifteen-student roster with unique, sequential indices", () => {
    expect(students).toHaveLength(15);
    expect(new Set(students.map((s) => s.id)).size).toBe(15);
    expect(q1Answers.map((a) => a.studentIndex)).toEqual([...Array(15)].map((_, i) => i + 1));
  });

  it("has fifteen answers to question 1 and five to question 2, all from rostered students", () => {
    expect(q1Answers).toHaveLength(15);
    expect(q2Answers).toHaveLength(5);
    const roster = new Set(students.map((s) => s.id));
    for (const a of answers) expect(roster.has(a.studentId), a.id).toBe(true);
    expect(new Set(answers.map((a) => a.id)).size).toBe(answers.length);
  });

  it("has ground truth for every question 1 answer covering every criterion, and none for question 2", () => {
    for (const a of q1Answers) {
      const gt = groundTruth[a.id];
      expect(gt, a.id).toBeDefined();
      expect(gt!.criteria.map((c) => c.criterionId).sort()).toEqual(q1.rubric.criteria.map((c) => c.id).sort());
    }
    for (const a of q2Answers) expect(groundTruth[a.id], a.id).toBeUndefined();
  });

  it("quotes evidence verbatim from the essay", () => {
    for (const a of q1Answers) {
      for (const c of groundTruth[a.id]!.criteria) {
        for (const quote of c.evidence) {
          expect(a.text, `${a.id}/${c.criterionId}: "${quote}"`).toContain(quote);
        }
      }
    }
  });

  it("only uses concept tags from the criterion vocabulary and valid band levels", () => {
    for (const a of q1Answers) {
      for (const c of groundTruth[a.id]!.criteria) {
        const crit = criterionById(c.criterionId);
        for (const tag of c.missingConcepts) expect(crit.concepts, `${a.id}/${c.criterionId}`).toContain(tag);
        expect(crit.bands.map((b) => b.level)).toContain(c.level);
      }
    }
  });

  it("sets up the demo: answers 4 and 11 share the reversibility omission", () => {
    for (const id of ["sub-04", "sub-11"]) {
      const rev = groundTruth[id]!.criteria.find((c) => c.criterionId === "reversibility")!;
      expect(rev.missingConcepts).toContain("reversibility");
    }
  });

  it("reuses a concept tag across questions, so per-question drift scoping is demonstrable", () => {
    const tags = (q: Question) => new Set(q.rubric.criteria.flatMap((c) => c.concepts));
    const shared = [...tags(q1)].filter((t) => tags(q2).has(t));
    expect(shared).toContain("quantitative_reference");
  });
});

describe("mockAnalyze", () => {
  it("produces a schema-valid result for every answer, scoped to its own question", () => {
    for (const a of answers) {
      const question = assignment.questions.find((q) => q.id === a.questionId)!;
      const result = mockAnalyze(a, assignment, question, groundTruth);
      expect(() => AnalysisResultSchema.parse(result)).not.toThrow();
      expect(result.answerId).toBe(a.id);
      expect(result.questionId).toBe(question.id);
      expect(result.criteria).toHaveLength(question.rubric.criteria.length);
      expect(result.feedbackDraft.length).toBeGreaterThan(40);
    }
  });
});
