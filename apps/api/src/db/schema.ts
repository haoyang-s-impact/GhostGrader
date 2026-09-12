import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { Question } from "@gg/shared";

/**
 * Relational shape of the data model in `packages/shared/src/schemas.ts`.
 * Documents that are always read and written whole (questions with their
 * rubrics, learning objectives, concept lists) are JSON columns. Any change
 * here needs a migration: `pnpm --filter @gg/api db:generate`.
 */

export const teachers = sqliteTable("teachers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
});

export const courses = sqliteTable(
  "courses",
  {
    id: text("id").primaryKey(),
    teacherId: text("teacher_id").notNull().references(() => teachers.id),
    name: text("name").notNull(),
    term: text("term").notNull().default(""),
    lmsCourseId: text("lms_course_id").notNull().default(""),
  },
  (t) => [index("courses_teacher_idx").on(t.teacherId)],
);

export const students = sqliteTable(
  "students",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    lmsStudentId: text("lms_student_id").notNull().default(""),
  },
  (t) => [index("students_lms_idx").on(t.lmsStudentId)],
);

export const assignments = sqliteTable(
  "assignments",
  {
    id: text("id").primaryKey(),
    teacherId: text("teacher_id").notNull().references(() => teachers.id),
    courseId: text("course_id").notNull().references(() => courses.id),
    title: text("title").notNull(),
    course: text("course").notNull(),
    learningObjectives: text("learning_objectives", { mode: "json" }).$type<string[]>().notNull(),
    /** Ordered questions, each with its rubric and anchors. */
    questions: text("questions", { mode: "json" }).$type<Question[]>().notNull(),
    updatedAt: integer("updated_at").notNull().default(0),
    lmsAssignmentId: text("lms_assignment_id").notNull().default(""),
    lastPulledAt: integer("last_pulled_at").notNull().default(0),
  },
  (t) => [index("assignments_teacher_idx").on(t.teacherId), index("assignments_course_idx").on(t.courseId)],
);

export const answers = sqliteTable(
  "answers",
  {
    id: text("id").primaryKey(),
    assignmentId: text("assignment_id").notNull().references(() => assignments.id),
    questionId: text("question_id").notNull(),
    studentId: text("student_id").notNull().references(() => students.id),
    studentName: text("student_name").notNull(),
    studentIndex: integer("student_index").notNull(),
    text: text("text").notNull(),
    lmsAnswerId: text("lms_answer_id").notNull().default(""),
    submittedAt: integer("submitted_at").notNull().default(0),
    pulledAt: integer("pulled_at").notNull().default(0),
  },
  (t) => [index("answers_assignment_idx").on(t.assignmentId), index("answers_question_idx").on(t.assignmentId, t.questionId)],
);

/** One row per answer: the teacher's latest submitted grade as Ghost Grader saw it. */
export const decisions = sqliteTable(
  "decisions",
  {
    id: text("id").primaryKey(),
    assignmentId: text("assignment_id").notNull().references(() => assignments.id),
    questionId: text("question_id").notNull(),
    answerId: text("answer_id").notNull(),
    studentId: text("student_id").notNull(),
    studentIndex: integer("student_index").notNull(),
    studentName: text("student_name").notNull().default(""),
    points: real("points").notNull(),
    maxPoints: real("max_points").notNull(),
    suggestedPoints: real("suggested_points"),
    missingConcepts: text("missing_concepts", { mode: "json" }).$type<string[]>().notNull(),
    comment: text("comment").notNull().default(""),
    at: integer("at").notNull(),
  },
  (t) => [index("decisions_assignment_idx").on(t.assignmentId), index("decisions_question_idx").on(t.assignmentId, t.questionId)],
);

/** Pairs of decisions the teacher chose not to align ("Keep mine"). */
export const overrides = sqliteTable(
  "overrides",
  {
    assignmentId: text("assignment_id").notNull().references(() => assignments.id),
    key: text("key").notNull(),
  },
  (t) => [uniqueIndex("overrides_pair_idx").on(t.assignmentId, t.key)],
);

export const sessionStats = sqliteTable("session_stats", {
  assignmentId: text("assignment_id").primaryKey().references(() => assignments.id),
  alertsRaised: integer("alerts_raised").notNull().default(0),
  alertsAligned: integer("alerts_aligned").notNull().default(0),
  checksRaised: integer("checks_raised").notNull().default(0),
  checksApproved: integer("checks_approved").notNull().default(0),
  checksRaisedFor: text("checks_raised_for", { mode: "json" }).$type<string[]>().notNull().default([]),
});

/** What has been sent to the LMS. Several rows per answer are possible; the latest wins. */
export const pushes = sqliteTable(
  "pushes",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    assignmentId: text("assignment_id").notNull().references(() => assignments.id),
    answerId: text("answer_id").notNull(),
    questionId: text("question_id").notNull(),
    studentId: text("student_id").notNull(),
    points: real("points").notNull(),
    clientReferenceId: text("client_reference_id").notNull(),
    status: text("status").$type<"pending" | "pushed" | "failed">().notNull(),
    lmsGradeId: text("lms_grade_id").notNull().default(""),
    pushedAt: integer("pushed_at").notNull().default(0),
    error: text("error").notNull().default(""),
  },
  (t) => [index("pushes_assignment_idx").on(t.assignmentId)],
);
