import { describe, expect, it } from "vitest";
import { assignment, criterionById, groundTruth, submissions } from "../src/data";
import { mockAnalyze } from "../src/mock-analyzer";
import { AnalysisResultSchema } from "../src/schemas";

describe("seeded dataset", () => {
  it("has six criteria with a closed concept vocabulary", () => {
    expect(assignment.rubric.criteria).toHaveLength(6);
    for (const c of assignment.rubric.criteria) {
      expect(c.concepts.length).toBeGreaterThan(0);
      expect(c.bands[0]!.points).toBe(c.maxPoints);
    }
  });

  it("has fifteen submissions with unique, sequential indices", () => {
    expect(submissions).toHaveLength(15);
    expect(submissions.map((s) => s.index)).toEqual([...Array(15)].map((_, i) => i + 1));
    expect(new Set(submissions.map((s) => s.id)).size).toBe(15);
  });

  it("has ground truth for every submission covering every criterion", () => {
    for (const s of submissions) {
      const gt = groundTruth[s.id];
      expect(gt, s.id).toBeDefined();
      expect(gt!.criteria.map((c) => c.criterionId).sort()).toEqual(
        assignment.rubric.criteria.map((c) => c.id).sort(),
      );
    }
  });

  it("quotes evidence verbatim from the essay", () => {
    for (const s of submissions) {
      for (const c of groundTruth[s.id]!.criteria) {
        for (const quote of c.evidence) {
          expect(s.text, `${s.id}/${c.criterionId}: "${quote}"`).toContain(quote);
        }
      }
    }
  });

  it("only uses concept tags from the criterion vocabulary and valid band levels", () => {
    for (const s of submissions) {
      for (const c of groundTruth[s.id]!.criteria) {
        const crit = criterionById(c.criterionId);
        for (const tag of c.missingConcepts) expect(crit.concepts, `${s.id}/${c.criterionId}`).toContain(tag);
        expect(crit.bands.map((b) => b.level)).toContain(c.level);
      }
    }
  });

  it("sets up the demo: submissions 4 and 11 share the reversibility omission", () => {
    for (const id of ["sub-04", "sub-11"]) {
      const rev = groundTruth[id]!.criteria.find((c) => c.criterionId === "reversibility")!;
      expect(rev.missingConcepts).toContain("reversibility");
    }
  });
});

describe("mockAnalyze", () => {
  it("produces a schema-valid result for every submission", () => {
    for (const s of submissions) {
      const result = mockAnalyze(s, assignment, groundTruth);
      expect(() => AnalysisResultSchema.parse(result)).not.toThrow();
      expect(result.criteria).toHaveLength(6);
      expect(result.feedbackDraft.length).toBeGreaterThan(40);
    }
  });
});
