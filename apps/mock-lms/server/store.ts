import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { answers, assignment, questionMax, students } from "@gg/shared";

/**
 * The mock LMS's own database. Deliberately shaped like a foreign system
 * (snake_case, points_possible, ISO timestamps): Ghost Grader reaches it only
 * over HTTP, through its LMS adapter, exactly as it would reach Canvas.
 */
export interface LmsCourse {
  id: string;
  name: string;
  term: string;
}

export interface LmsQuestion {
  id: string;
  position: number;
  name: string;
  question_text: string;
  points_possible: number;
}

export interface LmsAssignment {
  id: string;
  course_id: string;
  course_name: string;
  name: string;
  description: string;
  questions: LmsQuestion[];
}

export interface LmsUser {
  id: string;
  name: string;
}

export interface LmsSubmission {
  id: string;
  assignment_id: string;
  question_id: string;
  user_id: string;
  user_name: string;
  body: string;
  submitted_at: string;
}

/** One gradebook cell: at most one grade per (assignment, question, user). */
export interface LmsGrade {
  id: string;
  assignment_id: string;
  question_id: string;
  user_id: string;
  score: number;
  comment: string;
  graded_at: string;
  client_reference_id: string;
}

export interface LmsGradeInput {
  question_id: string;
  user_id: string;
  score: number;
  comment?: string;
  client_reference_id: string;
}

export interface LmsData {
  schemaVersion: number;
  courses: LmsCourse[];
  assignments: LmsAssignment[];
  users: LmsUser[];
  submissions: LmsSubmission[];
  grades: LmsGrade[];
}

export const LMS_SCHEMA_VERSION = 1;

/** A fixed submission time for the seed, so the data is the same on every machine. */
const SEEDED_AT = "2026-09-10T09:00:00.000Z";

export function seedLmsData(): LmsData {
  return {
    schemaVersion: LMS_SCHEMA_VERSION,
    courses: [{ id: "lms-c-chem101", name: assignment.course, term: "Fall 2026" }],
    assignments: [
      {
        id: assignment.lmsAssignmentId,
        course_id: "lms-c-chem101",
        course_name: assignment.course,
        name: assignment.title,
        description: "Two short-answer questions on chemical equilibrium.",
        questions: assignment.questions.map((q) => ({
          id: q.lmsQuestionId,
          position: q.index,
          name: q.title,
          question_text: q.prompt,
          points_possible: questionMax(q),
        })),
      },
    ],
    users: students.map((s) => ({ id: s.lmsStudentId, name: s.name })),
    submissions: answers.map((a) => ({
      id: a.lmsAnswerId,
      assignment_id: assignment.lmsAssignmentId,
      question_id: assignment.questions.find((q) => q.id === a.questionId)!.lmsQuestionId,
      user_id: students.find((s) => s.id === a.studentId)!.lmsStudentId,
      user_name: a.studentName,
      body: a.text,
      submitted_at: SEEDED_AT,
    })),
    // The gradebook starts empty. Grades arrive only when a teacher pushes them from Ghost Grader.
    grades: [],
  };
}

export interface GradeUpsertResult {
  accepted: LmsGrade[];
  rejected: { client_reference_id: string; reason: string }[];
}

export class LmsStore {
  private data: LmsData;
  private seq = 0;

  constructor(private readonly path?: string) {
    const loaded = path && existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Partial<LmsData>) : null;
    this.data = loaded && loaded.schemaVersion === LMS_SCHEMA_VERSION ? (loaded as LmsData) : seedLmsData();
    if (!loaded || loaded.schemaVersion !== LMS_SCHEMA_VERSION) this.flush();
  }

  private flush() {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.path);
  }

  courses() {
    return this.data.courses;
  }
  course(id: string) {
    return this.data.courses.find((c) => c.id === id);
  }
  assignments(courseId?: string) {
    return this.data.assignments.filter((a) => !courseId || a.course_id === courseId);
  }
  assignment(id: string) {
    return this.data.assignments.find((a) => a.id === id);
  }
  users() {
    return this.data.users;
  }
  submissions(assignmentId: string) {
    return this.data.submissions.filter((s) => s.assignment_id === assignmentId);
  }
  grades(assignmentId: string) {
    return this.data.grades.filter((g) => g.assignment_id === assignmentId);
  }

  /**
   * Upsert grades into gradebook cells. A grade for a student who has no
   * submission to that question is rejected, the way an LMS refuses a grade
   * for someone not enrolled. Re-sending the same client_reference_id is a
   * no-op that returns the existing receipt.
   */
  upsertGrades(assignmentId: string, inputs: LmsGradeInput[], now = new Date()): GradeUpsertResult {
    const a = this.assignment(assignmentId)!;
    const result: GradeUpsertResult = { accepted: [], rejected: [] };
    for (const g of inputs) {
      if (!a.questions.some((q) => q.id === g.question_id)) {
        result.rejected.push({ client_reference_id: g.client_reference_id, reason: `Question ${g.question_id} is not part of this assignment.` });
        continue;
      }
      if (!this.data.submissions.some((s) => s.assignment_id === assignmentId && s.question_id === g.question_id && s.user_id === g.user_id)) {
        result.rejected.push({ client_reference_id: g.client_reference_id, reason: `User ${g.user_id} has no submission for this question.` });
        continue;
      }
      const idx = this.data.grades.findIndex((x) => x.assignment_id === assignmentId && x.question_id === g.question_id && x.user_id === g.user_id);
      const prior = idx >= 0 ? this.data.grades[idx]! : undefined;
      if (prior && prior.client_reference_id === g.client_reference_id) {
        result.accepted.push(prior);
        continue;
      }
      const next: LmsGrade = {
        id: prior?.id ?? `lms-grade-${Date.now().toString(36)}-${++this.seq}`,
        assignment_id: assignmentId,
        question_id: g.question_id,
        user_id: g.user_id,
        score: g.score,
        comment: g.comment ?? "",
        graded_at: now.toISOString(),
        client_reference_id: g.client_reference_id,
      };
      if (prior) this.data.grades[idx] = next;
      else this.data.grades.push(next);
      result.accepted.push(next);
    }
    this.flush();
    return result;
  }

  clearGrades(assignmentId: string) {
    this.data.grades = this.data.grades.filter((g) => g.assignment_id !== assignmentId);
    this.flush();
  }
}
