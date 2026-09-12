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

export const TeacherSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
});

export const CourseSchema = z.object({
  id: z.string(),
  teacherId: z.string(),
  name: z.string(),
  term: z.string().default(""),
});

export const AssignmentSchema = z.object({
  id: z.string(),
  teacherId: z.string(),
  courseId: z.string(),
  title: z.string(),
  /** Display name of the course, denormalized for prompts and headers. */
  course: z.string(),
  prompt: z.string(),
  learningObjectives: z.array(z.string()),
  rubric: RubricSchema,
  anchors: z.array(AnchorSchema),
  /** Points the single grade is out of. Defaults to the sum of criterion maxima. */
  totalPoints: z.number().positive().optional(),
  updatedAt: z.number().default(0),
});

/** Payload a teacher sends when creating or editing an assignment. */
export const AssignmentInputSchema = AssignmentSchema.omit({ id: true, teacherId: true, course: true, updatedAt: true });

export const SubmissionSchema = z.object({
  id: z.string(),
  index: z.number().int().positive(),
  studentName: z.string(),
  text: z.string(),
});

export const StoredSubmissionSchema = SubmissionSchema.extend({ assignmentId: z.string() });

/** One criterion as the model returns it. */
export const ModelCriterionSchema = z.object({
  criterionId: z.string(),
  level: z.string(),
  evidence: z.array(z.string()),
  missingConcepts: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

/** What the model is asked to return. submissionId and suggestedPoints are stamped by the server. */
export const ModelOutputSchema = z.object({
  criteria: z.array(ModelCriterionSchema),
  /** One sentence for the teacher explaining the suggested grade. */
  summary: z.string(),
  feedbackDraft: z.string(),
});

export const CriterionAnalysisSchema = ModelCriterionSchema.extend({
  /** Points of the band the analysis selected, derived from the rubric, never from the model. */
  suggestedPoints: z.number(),
  /** Descriptor of that band, copied from the rubric so the panel can quote it. */
  bandDescriptor: z.string().default(""),
  maxPoints: z.number().default(0),
});

export const AnalysisResultSchema = z.object({
  submissionId: z.string(),
  criteria: z.array(CriterionAnalysisSchema),
  /** Rubric-derived grade on the assignment's scale. */
  suggestedTotal: z.number(),
  maxTotal: z.number(),
  /** Union of missing concepts across criteria; what the comparisons key on. */
  missingConcepts: z.array(z.string()),
  summary: z.string(),
  feedbackDraft: z.string(),
});

/** Raised when a teacher's grade diverges from the rubric-bound analysis. */
export const ScoreCheckSchema = z.object({
  enteredPoints: z.number(),
  suggestedPoints: z.number(),
  maxPoints: z.number(),
  diff: z.number(),
  summary: z.string(),
  missingConcepts: z.array(z.string()),
  breakdown: z.array(
    z.object({
      criterionId: z.string(),
      level: z.string(),
      suggestedPoints: z.number(),
      maxPoints: z.number(),
      missingConcepts: z.array(z.string()),
    }),
  ),
});

/** One overall grade the teacher entered for one submission. */
export const DecisionSchema = z.object({
  id: z.string(),
  assignmentId: z.string(),
  submissionId: z.string(),
  submissionIndex: z.number().int().positive(),
  studentName: z.string().default(""),
  points: z.number(),
  maxPoints: z.number(),
  /** What the rubric-bound analysis suggested at the time, if it was available. */
  suggestedPoints: z.number().nullable(),
  missingConcepts: z.array(z.string()),
  at: z.number(),
});

/**
 * Raised when this grade treats the same gaps differently from an earlier
 * student's grade. Offsets are (teacher points - suggested points), so the
 * comparison is about leniency relative to the rubric, not raw scores.
 */
export const DriftAlertSchema = z.object({
  currentDecisionId: z.string(),
  priorDecisionId: z.string(),
  currentSubmissionIndex: z.number(),
  priorSubmissionIndex: z.number(),
  priorStudentName: z.string(),
  sharedConcepts: z.array(z.string()),
  currentPoints: z.number(),
  priorPoints: z.number(),
  currentSuggested: z.number(),
  priorSuggested: z.number(),
  currentOffset: z.number(),
  priorOffset: z.number(),
  spread: z.number(),
  /** The grade that would treat this student the way the earlier one was treated. */
  recommendedPoints: z.number(),
  maxPoints: z.number(),
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
export type Teacher = z.infer<typeof TeacherSchema>;
export type Course = z.infer<typeof CourseSchema>;
export type Assignment = z.infer<typeof AssignmentSchema>;
export type AssignmentInput = z.infer<typeof AssignmentInputSchema>;
export type Submission = z.infer<typeof SubmissionSchema>;
export type StoredSubmission = z.infer<typeof StoredSubmissionSchema>;
export type ModelCriterion = z.infer<typeof ModelCriterionSchema>;
export type ModelOutput = z.infer<typeof ModelOutputSchema>;
export type CriterionAnalysis = z.infer<typeof CriterionAnalysisSchema>;
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
export type ScoreCheck = z.infer<typeof ScoreCheckSchema>;
export type Decision = z.infer<typeof DecisionSchema>;
export type DriftAlert = z.infer<typeof DriftAlertSchema>;
export type GroundTruth = z.infer<typeof GroundTruthSchema>;
