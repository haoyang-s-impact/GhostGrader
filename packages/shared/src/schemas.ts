import { z } from "zod";

export const BandSchema = z.object({
  level: z.string(),
  points: z.number(),
  descriptor: z.string(),
});

export const CriterionSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  maxPoints: z.number(),
  bands: z.array(BandSchema),
  /** Closed vocabulary of concept tags the model may emit for this criterion. */
  concepts: z.array(z.string()),
});

export const RubricSchema = z.object({
  id: z.string(),
  criteria: z.array(CriterionSchema),
});

export const AnchorSchema = z.object({ label: z.string(), text: z.string() });

export const AssignmentSchema = z.object({
  id: z.string(),
  title: z.string(),
  course: z.string(),
  prompt: z.string(),
  learningObjectives: z.array(z.string()),
  rubric: RubricSchema,
  anchors: z.array(AnchorSchema),
});

export const SubmissionSchema = z.object({
  id: z.string(),
  index: z.number().int().positive(),
  studentName: z.string(),
  text: z.string(),
});

export const CriterionAnalysisSchema = z.object({
  criterionId: z.string(),
  level: z.string(),
  evidence: z.array(z.string()),
  missingConcepts: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

export const AnalysisResultSchema = z.object({
  submissionId: z.string(),
  criteria: z.array(CriterionAnalysisSchema),
  feedbackDraft: z.string(),
});

/** What the model is asked to return. submissionId is stamped by the server. */
export const ModelOutputSchema = z.object({
  criteria: z.array(CriterionAnalysisSchema),
  feedbackDraft: z.string(),
});

export const DecisionSchema = z.object({
  id: z.string(),
  assignmentId: z.string(),
  submissionId: z.string(),
  submissionIndex: z.number().int().positive(),
  criterionId: z.string(),
  points: z.number(),
  deduction: z.number(),
  missingConcepts: z.array(z.string()),
  at: z.number(),
});

export const DriftAlertSchema = z.object({
  currentDecisionId: z.string(),
  priorDecisionId: z.string(),
  currentSubmissionIndex: z.number(),
  priorSubmissionIndex: z.number(),
  criterionId: z.string(),
  sharedConcept: z.string(),
  currentDeduction: z.number(),
  priorDeduction: z.number(),
  priorPoints: z.number(),
  spread: z.number(),
});

export const GroundTruthSchema = z.record(
  z.string(),
  z.object({
    criteria: z.array(
      z.object({
        criterionId: z.string(),
        level: z.string(),
        evidence: z.array(z.string()),
        missingConcepts: z.array(z.string()),
      }),
    ),
    strength: z.string(),
    improvement: z.string(),
  }),
);

export type Band = z.infer<typeof BandSchema>;
export type Criterion = z.infer<typeof CriterionSchema>;
export type Rubric = z.infer<typeof RubricSchema>;
export type Assignment = z.infer<typeof AssignmentSchema>;
export type Submission = z.infer<typeof SubmissionSchema>;
export type CriterionAnalysis = z.infer<typeof CriterionAnalysisSchema>;
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
export type ModelOutput = z.infer<typeof ModelOutputSchema>;
export type Decision = z.infer<typeof DecisionSchema>;
export type DriftAlert = z.infer<typeof DriftAlertSchema>;
export type GroundTruth = z.infer<typeof GroundTruthSchema>;
