import type { Assignment, AssignmentInput, Course, StoredSubmission, Teacher } from "@gg/shared";

export const API = "http://localhost:8787";
const TEACHER_KEY = "gg-mock-teacher";

export function currentTeacherId(): string {
  return localStorage.getItem(TEACHER_KEY) ?? "t-demo";
}
export function setCurrentTeacherId(id: string) {
  localStorage.setItem(TEACHER_KEY, id);
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "content-type": "application/json", "x-teacher-id": currentTeacherId(), ...(init.headers ?? {}) },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body && body.error) || `Request failed (${res.status})`);
  return body as T;
}

export const lms = {
  teachers: () => call<Teacher[]>("/lms/teachers"),
  me: () => call<Teacher>("/lms/me"),
  courses: () => call<Course[]>("/lms/courses"),
  createCourse: (name: string, term: string) => call<Course>("/lms/courses", { method: "POST", body: JSON.stringify({ name, term }) }),
  assignments: (courseId?: string) => call<Assignment[]>(`/lms/assignments${courseId ? `?courseId=${encodeURIComponent(courseId)}` : ""}`),
  assignment: (id: string) => call<Assignment>(`/lms/assignments/${id}`),
  createAssignment: (input: AssignmentInput) => call<Assignment>("/lms/assignments", { method: "POST", body: JSON.stringify(input) }),
  updateAssignment: (id: string, input: AssignmentInput) => call<Assignment>(`/lms/assignments/${id}`, { method: "PUT", body: JSON.stringify(input) }),
  submissions: (assignmentId: string) => call<StoredSubmission[]>(`/lms/assignments/${assignmentId}/submissions`),
  addSubmission: (assignmentId: string, studentName: string, text: string) =>
    call<StoredSubmission>(`/lms/assignments/${assignmentId}/submissions`, { method: "POST", body: JSON.stringify({ studentName, text }) }),
};
