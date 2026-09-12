/**
 * The boundary between Ghost Grader and an LMS. Everything LMS-specific lives
 * behind this interface: the mock LMS implements it today, and a Canvas
 * adapter is the only thing that has to be written to point at a real one.
 *
 * The LMS owns courses, assignments, questions and student answers. It does
 * not own rubrics: it knows how many points a question is worth, and the
 * analytic rubric is Ghost Grader's own artifact.
 */

export class LmsError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly status?: number,
  ) {
    super(message);
  }
}

export interface LmsAssignmentSummary {
  lmsId: string;
  courseName: string;
  title: string;
  questionCount: number;
}

export interface PullResult {
  course: { lmsId: string; name: string; term: string };
  assignment: { lmsId: string; title: string; description: string };
  questions: { lmsId: string; index: number; title: string; prompt: string; pointsPossible: number }[];
  answers: {
    lmsId: string;
    lmsQuestionId: string;
    lmsStudentId: string;
    studentName: string;
    text: string;
    submittedAt: number;
  }[];
}

export interface PushGrade {
  lmsQuestionId: string;
  lmsStudentId: string;
  points: number;
  comment?: string;
  /** Content-addressed `${answerId}:${points}`; the LMS upserts on it, so a repeated push is a no-op. */
  clientReferenceId: string;
}

export interface PushResult {
  accepted: { clientReferenceId: string; lmsGradeId: string; gradedAt: number }[];
  rejected: { clientReferenceId: string; reason: string }[];
}

export interface LmsAdapter {
  readonly name: "canvas" | "fake";
  listAssignments(): Promise<LmsAssignmentSummary[]>;
  pullAssignment(lmsAssignmentId: string): Promise<PullResult>;
  pushGrades(lmsAssignmentId: string, grades: PushGrade[]): Promise<PushResult>;
}

/**
 * Exactly one immediate retry, skipped for non-retryable errors, matching the
 * LLM providers. Safe for pushes too: grades are upserted on their
 * content-addressed reference, so a retried POST cannot double-write.
 */
export async function withOneRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof LmsError && !err.retryable) throw err;
    return await run();
  }
}
