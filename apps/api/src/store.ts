import { and, asc, eq, inArray } from "drizzle-orm";
import type { Answer, Assignment, Course, Decision, PushRecord, Student, Teacher } from "@gg/shared";
import { openDb, schema, type Db } from "./db";
import { emptySession, seedData, type SeedOptions, type SessionState } from "./json-store";

export { emptySession, seedData, SCHEMA_VERSION, type SeedOptions, type SessionState, type StoreData } from "./json-store";

/**
 * SQLite persistence through Drizzle. Teachers, courses, assignments with
 * their questions and rubrics, the roster, answers, grading sessions and
 * push records. Same public surface as the JSON store it replaced, so the
 * routes, the session service and the sync layer do not know the difference.
 * Pass no path for an in-memory database (tests). An empty database is
 * seeded with the demo data on first open.
 */
export class Store {
  readonly db: Db;
  private readonly sqlite;
  readonly path: string;

  constructor(path?: string, seed: SeedOptions = {}, log?: (m: string) => void) {
    this.path = path ?? ":memory:";
    const opened = openDb(this.path);
    this.db = opened.db;
    this.sqlite = opened.sqlite;
    if (this.db.select().from(schema.teachers).limit(1).all().length === 0) {
      log?.(`Database ${this.path} is empty. Seeding the demo data.`);
      this.seed(seed);
    }
  }

  close() {
    this.sqlite.close();
  }

  private seed(opts: SeedOptions) {
    const data = seedData(opts);
    this.db.transaction((tx) => {
      tx.insert(schema.teachers).values(data.teachers).run();
      tx.insert(schema.courses).values(data.courses).run();
      if (data.students.length) tx.insert(schema.students).values(data.students).run();
      tx.insert(schema.assignments).values(data.assignments.map(toAssignmentRow)).run();
      if (data.answers.length) tx.insert(schema.answers).values(data.answers).run();
    });
  }

  // ----- teachers -----
  teachers(): Teacher[] {
    return this.db.select().from(schema.teachers).all();
  }
  teacher(id: string): Teacher | undefined {
    return this.db.select().from(schema.teachers).where(eq(schema.teachers.id, id)).get();
  }

  // ----- courses -----
  coursesFor(teacherId: string): Course[] {
    return this.db.select().from(schema.courses).where(eq(schema.courses.teacherId, teacherId)).all();
  }
  course(teacherId: string, id: string): Course | undefined {
    return this.db.select().from(schema.courses).where(and(eq(schema.courses.id, id), eq(schema.courses.teacherId, teacherId))).get();
  }
  courseByLmsId(teacherId: string, lmsCourseId: string): Course | undefined {
    if (lmsCourseId === "") return undefined;
    return this.db.select().from(schema.courses).where(and(eq(schema.courses.teacherId, teacherId), eq(schema.courses.lmsCourseId, lmsCourseId))).get();
  }
  createCourse(teacherId: string, name: string, term: string, lmsCourseId = ""): Course {
    const course: Course = { id: newId("c"), teacherId, name, term, lmsCourseId };
    this.db.insert(schema.courses).values(course).run();
    return course;
  }

  // ----- assignments -----
  assignmentsFor(teacherId: string, courseId?: string): Assignment[] {
    const where = courseId ? and(eq(schema.assignments.teacherId, teacherId), eq(schema.assignments.courseId, courseId)) : eq(schema.assignments.teacherId, teacherId);
    return this.db.select().from(schema.assignments).where(where).all().map(fromAssignmentRow);
  }
  assignment(teacherId: string, id: string): Assignment | undefined {
    const row = this.db.select().from(schema.assignments).where(and(eq(schema.assignments.id, id), eq(schema.assignments.teacherId, teacherId))).get();
    return row ? fromAssignmentRow(row) : undefined;
  }
  assignmentByLmsId(teacherId: string, lmsAssignmentId: string): Assignment | undefined {
    if (lmsAssignmentId === "") return undefined;
    const row = this.db
      .select()
      .from(schema.assignments)
      .where(and(eq(schema.assignments.teacherId, teacherId), eq(schema.assignments.lmsAssignmentId, lmsAssignmentId)))
      .get();
    return row ? fromAssignmentRow(row) : undefined;
  }
  createAssignment(a: Assignment): Assignment {
    this.db.insert(schema.assignments).values(toAssignmentRow(a)).run();
    return a;
  }
  updateAssignment(teacherId: string, id: string, patch: Omit<Assignment, "id" | "teacherId">): Assignment | undefined {
    if (!this.assignment(teacherId, id)) return undefined;
    const next: Assignment = { ...patch, id, teacherId };
    const { id: _id, ...values } = toAssignmentRow(next);
    this.db.update(schema.assignments).set(values).where(eq(schema.assignments.id, id)).run();
    return next;
  }

  // ----- students -----
  student(id: string): Student | undefined {
    return this.db.select().from(schema.students).where(eq(schema.students.id, id)).get();
  }
  studentByLmsId(lmsStudentId: string): Student | undefined {
    if (lmsStudentId === "") return undefined;
    return this.db.select().from(schema.students).where(eq(schema.students.lmsStudentId, lmsStudentId)).get();
  }
  upsertStudent(s: Student): Student {
    const { id, ...rest } = s;
    this.db.insert(schema.students).values(s).onConflictDoUpdate({ target: schema.students.id, set: rest }).run();
    return s;
  }

  // ----- answers -----
  answersFor(assignmentId: string, questionId?: string): Answer[] {
    const where = questionId ? and(eq(schema.answers.assignmentId, assignmentId), eq(schema.answers.questionId, questionId)) : eq(schema.answers.assignmentId, assignmentId);
    return this.db.select().from(schema.answers).where(where).orderBy(asc(schema.answers.studentIndex)).all();
  }
  answer(assignmentId: string, id: string): Answer | undefined {
    return this.db.select().from(schema.answers).where(and(eq(schema.answers.assignmentId, assignmentId), eq(schema.answers.id, id))).get();
  }
  answerByLmsId(assignmentId: string, lmsAnswerId: string): Answer | undefined {
    if (lmsAnswerId === "") return undefined;
    return this.db.select().from(schema.answers).where(and(eq(schema.answers.assignmentId, assignmentId), eq(schema.answers.lmsAnswerId, lmsAnswerId))).get();
  }
  upsertAnswer(a: Answer): Answer {
    const { id, ...rest } = a;
    this.db.insert(schema.answers).values(a).onConflictDoUpdate({ target: schema.answers.id, set: rest }).run();
    return a;
  }

  // ----- sessions -----
  session(assignmentId: string): SessionState {
    const decisions = this.db.select().from(schema.decisions).where(eq(schema.decisions.assignmentId, assignmentId)).orderBy(asc(schema.decisions.at)).all();
    const overrides = this.db.select({ key: schema.overrides.key }).from(schema.overrides).where(eq(schema.overrides.assignmentId, assignmentId)).all();
    const stats = this.db.select().from(schema.sessionStats).where(eq(schema.sessionStats.assignmentId, assignmentId)).get();
    return {
      ...emptySession(),
      decisions,
      overrides: overrides.map((o) => o.key),
      checksRaisedFor: stats?.checksRaisedFor ?? [],
      alertsRaised: stats?.alertsRaised ?? 0,
      alertsAligned: stats?.alertsAligned ?? 0,
      checksRaised: stats?.checksRaised ?? 0,
      checksApproved: stats?.checksApproved ?? 0,
    };
  }

  /** Write the whole session state in one transaction: decisions upserted and pruned, overrides replaced, stats upserted. */
  saveSession(assignmentId: string, s: SessionState) {
    this.db.transaction((tx) => {
      const keep = s.decisions.map((d) => d.id);
      const existing = tx.select({ id: schema.decisions.id }).from(schema.decisions).where(eq(schema.decisions.assignmentId, assignmentId)).all().map((r) => r.id);
      const stale = existing.filter((id) => !keep.includes(id));
      if (stale.length) tx.delete(schema.decisions).where(and(eq(schema.decisions.assignmentId, assignmentId), inArray(schema.decisions.id, stale))).run();
      for (const d of s.decisions) {
        const { id, ...rest } = d;
        tx.insert(schema.decisions).values(d).onConflictDoUpdate({ target: schema.decisions.id, set: rest }).run();
      }
      tx.delete(schema.overrides).where(eq(schema.overrides.assignmentId, assignmentId)).run();
      if (s.overrides.length) tx.insert(schema.overrides).values(s.overrides.map((key) => ({ assignmentId, key }))).run();
      const stats = {
        alertsRaised: s.alertsRaised,
        alertsAligned: s.alertsAligned,
        checksRaised: s.checksRaised,
        checksApproved: s.checksApproved,
        checksRaisedFor: s.checksRaisedFor ?? [],
      };
      tx.insert(schema.sessionStats).values({ assignmentId, ...stats }).onConflictDoUpdate({ target: schema.sessionStats.assignmentId, set: stats }).run();
    });
  }
  resetSession(assignmentId: string) {
    this.db.transaction((tx) => {
      tx.delete(schema.decisions).where(eq(schema.decisions.assignmentId, assignmentId)).run();
      tx.delete(schema.overrides).where(eq(schema.overrides.assignmentId, assignmentId)).run();
      tx.delete(schema.sessionStats).where(eq(schema.sessionStats.assignmentId, assignmentId)).run();
    });
  }

  // ----- pushes -----
  pushesFor(assignmentId: string): PushRecord[] {
    return this.db
      .select()
      .from(schema.pushes)
      .where(eq(schema.pushes.assignmentId, assignmentId))
      .orderBy(asc(schema.pushes.seq))
      .all()
      .map(({ seq: _seq, assignmentId: _a, ...rec }) => rec);
  }
  savePushes(assignmentId: string, records: PushRecord[]) {
    this.db.transaction((tx) => {
      tx.delete(schema.pushes).where(eq(schema.pushes.assignmentId, assignmentId)).run();
      if (records.length) tx.insert(schema.pushes).values(records.map((r) => ({ ...r, assignmentId }))).run();
    });
  }
}

function toAssignmentRow(a: Assignment): typeof schema.assignments.$inferInsert {
  return {
    id: a.id,
    teacherId: a.teacherId,
    courseId: a.courseId,
    title: a.title,
    course: a.course,
    learningObjectives: a.learningObjectives,
    questions: a.questions,
    updatedAt: a.updatedAt,
    lmsAssignmentId: a.lmsAssignmentId,
    lastPulledAt: a.lastPulledAt,
  };
}

function fromAssignmentRow(r: typeof schema.assignments.$inferSelect): Assignment {
  return {
    id: r.id,
    teacherId: r.teacherId,
    courseId: r.courseId,
    title: r.title,
    course: r.course,
    learningObjectives: r.learningObjectives,
    questions: r.questions,
    updatedAt: r.updatedAt,
    lmsAssignmentId: r.lmsAssignmentId,
    lastPulledAt: r.lastPulledAt,
  };
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
