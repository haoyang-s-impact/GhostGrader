import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  assignment as seededAssignment,
  submissions as seededSubmissions,
  type Assignment,
  type Course,
  type Decision,
  type StoredSubmission,
  type Teacher,
} from "@gg/shared";

export interface SessionState {
  decisions: Decision[];
  overrides: string[];
  alertsRaised: number;
  alertsAligned: number;
  checksRaised: number;
  checksApproved: number;
}

export interface StoreData {
  teachers: Teacher[];
  courses: Course[];
  assignments: Assignment[];
  submissions: StoredSubmission[];
  sessions: Record<string, SessionState>;
}

export function emptySession(): SessionState {
  return { decisions: [], overrides: [], alertsRaised: 0, alertsAligned: 0, checksRaised: 0, checksApproved: 0 };
}

export function seedData(): StoreData {
  return {
    teachers: [
      { id: "t-demo", name: "Dr. Selin Demir", email: "selin.demir@example.edu" },
      { id: "t-second", name: "Mr. James Park", email: "james.park@example.edu" },
    ],
    courses: [
      { id: "c-chem101", teacherId: "t-demo", name: "CHEM 101: General Chemistry", term: "Fall 2026" },
      { id: "c-hist210", teacherId: "t-second", name: "HIST 210: Modern Europe", term: "Fall 2026" },
    ],
    assignments: [{ ...seededAssignment, updatedAt: Date.now() }],
    submissions: seededSubmissions.map((s) => ({ ...s, assignmentId: seededAssignment.id })),
    sessions: {},
  };
}

/**
 * Tiny JSON-file persistence. Multi-tenant data (teachers, courses,
 * assignments with their rubrics, submissions) and grading sessions live in
 * one file that is rewritten atomically on every change. Pass no path for a
 * memory-only store (tests).
 */
export class Store {
  private data: StoreData;

  constructor(private readonly path?: string) {
    if (path && existsSync(path)) {
      this.data = JSON.parse(readFileSync(path, "utf8")) as StoreData;
    } else {
      this.data = seedData();
      this.flush();
    }
  }

  private flush() {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.path);
  }

  // ----- teachers -----
  teachers(): Teacher[] {
    return this.data.teachers;
  }
  teacher(id: string): Teacher | undefined {
    return this.data.teachers.find((t) => t.id === id);
  }

  // ----- courses -----
  coursesFor(teacherId: string): Course[] {
    return this.data.courses.filter((c) => c.teacherId === teacherId);
  }
  course(teacherId: string, id: string): Course | undefined {
    return this.data.courses.find((c) => c.id === id && c.teacherId === teacherId);
  }
  createCourse(teacherId: string, name: string, term: string): Course {
    const course: Course = { id: newId("c"), teacherId, name, term };
    this.data.courses.push(course);
    this.flush();
    return course;
  }

  // ----- assignments -----
  assignmentsFor(teacherId: string, courseId?: string): Assignment[] {
    return this.data.assignments.filter((a) => a.teacherId === teacherId && (!courseId || a.courseId === courseId));
  }
  assignment(teacherId: string, id: string): Assignment | undefined {
    return this.data.assignments.find((a) => a.id === id && a.teacherId === teacherId);
  }
  createAssignment(a: Assignment): Assignment {
    this.data.assignments.push(a);
    this.flush();
    return a;
  }
  updateAssignment(teacherId: string, id: string, patch: Omit<Assignment, "id" | "teacherId">): Assignment | undefined {
    const idx = this.data.assignments.findIndex((a) => a.id === id && a.teacherId === teacherId);
    if (idx < 0) return undefined;
    const next: Assignment = { ...patch, id, teacherId };
    this.data.assignments[idx] = next;
    this.flush();
    return next;
  }

  // ----- submissions -----
  submissionsFor(assignmentId: string): StoredSubmission[] {
    return this.data.submissions.filter((s) => s.assignmentId === assignmentId).sort((a, b) => a.index - b.index);
  }
  addSubmission(assignmentId: string, studentName: string, text: string): StoredSubmission {
    const existing = this.submissionsFor(assignmentId);
    const sub: StoredSubmission = { id: newId("sub"), assignmentId, index: existing.length + 1, studentName, text };
    this.data.submissions.push(sub);
    this.flush();
    return sub;
  }

  // ----- sessions -----
  session(assignmentId: string): SessionState {
    return (this.data.sessions[assignmentId] ??= emptySession());
  }
  saveSession(assignmentId: string, s: SessionState) {
    this.data.sessions[assignmentId] = s;
    this.flush();
  }
  resetSession(assignmentId: string) {
    delete this.data.sessions[assignmentId];
    this.flush();
  }
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
