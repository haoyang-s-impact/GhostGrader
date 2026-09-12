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

/**
 * Material students work from: the clip in a listening task, the menu or chart
 * they answer about. Answers stay text; media is for the teacher to replay and,
 * through its transcript, for the analyzer to read. `src` is a URL, relative
 * ones resolving against the web app (seeded files live in apps/web/public).
 */
export const QuestionMediaSchema = z.object({
  kind: z.enum(["audio", "image"]),
  src: z.string(),
  label: z.string(),
  /** What an audio clip says, transcribed once when the question is set up (scripts/transcribe-media.ts). */
  transcript: z.string().optional(),
});

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
  /** Identifier of this course in the LMS. Empty for locally created courses. */
  lmsCourseId: z.string().default(""),
});

/**
 * One question within an assignment. The rubric lives here, not on the
 * assignment: grading is per (student, question), and concept tags, band
 * descriptors and the drift threshold are all rubric-scoped, so an
 * assignment-wide rubric stops meaning anything the moment two questions
 * differ.
 */
export const QuestionSchema = z.object({
  id: z.string(),
  index: z.number().int().positive(),
  title: z.string().default(""),
  prompt: z.string(),
  rubric: RubricSchema,
  anchors: z.array(AnchorSchema).default([]),
  /**
   * Optional, not defaulted: questions are stored as a JSON column and read back
   * with a cast, so rows written before this field existed have no `media`.
   */
  media: z.array(QuestionMediaSchema).optional(),
  /** Points this question's grade is out of. Defaults to the sum of criterion maxima. */
  totalPoints: z.number().positive().optional(),
  /** Identifier of this question in the LMS. Empty for locally authored questions. */
  lmsQuestionId: z.string().default(""),
});

export const AssignmentSchema = z.object({
  id: z.string(),
  teacherId: z.string(),
  courseId: z.string(),
  title: z.string(),
  /** Display name of the course, denormalized for prompts and headers. */
  course: z.string(),
  learningObjectives: z.array(z.string()),
  /** Ordered questions. Questions inherit the assignment's updatedAt. */
  questions: z.array(QuestionSchema).min(1),
  updatedAt: z.number().default(0),
  /** Set when this assignment was pulled from an LMS; empty when authored locally. */
  lmsAssignmentId: z.string().default(""),
  lastPulledAt: z.number().default(0),
});

/** Payload a teacher sends when creating or editing an assignment. */
export const AssignmentInputSchema = AssignmentSchema.omit({
  id: true,
  teacherId: true,
  course: true,
  updatedAt: true,
  lmsAssignmentId: true,
  lastPulledAt: true,
});

export const StudentSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Identifier of this student in the LMS. Empty for locally added students. */
  lmsStudentId: z.string().default(""),
});

/** One student's answer to one question. Replaces the old flat Submission. */
export const AnswerSchema = z.object({
  id: z.string(),
  assignmentId: z.string(),
  questionId: z.string(),
  studentId: z.string(),
  /** Denormalized for prompts, the panel and alert copy. */
  studentName: z.string(),
  /** Roster position within the assignment, stable across questions. */
  studentIndex: z.number().int().positive(),
  text: z.string(),
  /** Opaque LMS id. The pull upsert key; empty for locally added answers. */
  lmsAnswerId: z.string().default(""),
  submittedAt: z.number().default(0),
  pulledAt: z.number().default(0),
});

/** One criterion as the model returns it. */
export const ModelCriterionSchema = z.object({
  criterionId: z.string(),
  level: z.string(),
  evidence: z.array(z.string()),
  missingConcepts: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

/** What the model is asked to return. Ids and suggestedPoints are stamped by the server. */
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
  answerId: z.string(),
  questionId: z.string(),
  criteria: z.array(CriterionAnalysisSchema),
  /** Rubric-derived grade on this question's scale. */
  suggestedTotal: z.number(),
  maxTotal: z.number(),
  /** Union of missing concepts across criteria; what the comparisons key on. */
  missingConcepts: z.array(z.string()),
  summary: z.string(),
  feedbackDraft: z.string(),
  /** Which provider produced this result, e.g. "openrouter", "openai", "claude", "mock". */
  provider: z.string().optional(),
});

/** Raised when a teacher's grade diverges from the rubric-bound analysis. */
export const ScoreCheckSchema = z.object({
  questionId: z.string(),
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

/** One grade the teacher entered for one student's answer to one question. */
export const DecisionSchema = z.object({
  id: z.string(),
  assignmentId: z.string(),
  questionId: z.string(),
  answerId: z.string(),
  studentId: z.string(),
  studentIndex: z.number().int().positive(),
  studentName: z.string().default(""),
  points: z.number(),
  maxPoints: z.number(),
  /** What the rubric-bound analysis suggested at the time, if it was available. */
  suggestedPoints: z.number().nullable(),
  missingConcepts: z.array(z.string()),
  /** Feedback the teacher wrote for the student; pushed to the LMS with the grade. */
  comment: z.string().default(""),
  at: z.number(),
});

/**
 * Raised when this grade treats the same gaps differently from an earlier
 * student's grade on the same question. Offsets are (teacher points -
 * suggested points), so the comparison is about leniency relative to the
 * rubric, not raw scores.
 */
export const DriftAlertSchema = z.object({
  questionId: z.string(),
  currentDecisionId: z.string(),
  priorDecisionId: z.string(),
  currentStudentIndex: z.number(),
  priorStudentIndex: z.number(),
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

/**
 * What Ghost Grader has sent to the LMS. Kept separate from Decision on
 * purpose: a re-grade replaces its Decision wholesale by deterministic id, so
 * sync state attached there would erase the fact that a grade was already
 * pushed. Separate records give "you pushed 23; the grade is now 20" for free.
 */
export const PushRecordSchema = z.object({
  answerId: z.string(),
  questionId: z.string(),
  studentId: z.string(),
  points: z.number(),
  /** Content-addressed from answer, points and comment (see pushReference), so a repeated push is a no-op. */
  clientReferenceId: z.string(),
  status: z.enum(["pending", "pushed", "failed"]),
  lmsGradeId: z.string().default(""),
  pushedAt: z.number().default(0),
  error: z.string().default(""),
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
export type Anchor = z.infer<typeof AnchorSchema>;
export type QuestionMedia = z.infer<typeof QuestionMediaSchema>;
export type Teacher = z.infer<typeof TeacherSchema>;
export type Course = z.infer<typeof CourseSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type Assignment = z.infer<typeof AssignmentSchema>;
export type AssignmentInput = z.infer<typeof AssignmentInputSchema>;
export type Student = z.infer<typeof StudentSchema>;
export type Answer = z.infer<typeof AnswerSchema>;
export type ModelCriterion = z.infer<typeof ModelCriterionSchema>;
export type ModelOutput = z.infer<typeof ModelOutputSchema>;
export type CriterionAnalysis = z.infer<typeof CriterionAnalysisSchema>;
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
export type ScoreCheck = z.infer<typeof ScoreCheckSchema>;
export type Decision = z.infer<typeof DecisionSchema>;
export type DriftAlert = z.infer<typeof DriftAlertSchema>;
export type PushRecord = z.infer<typeof PushRecordSchema>;
export type GroundTruth = z.infer<typeof GroundTruthSchema>;
