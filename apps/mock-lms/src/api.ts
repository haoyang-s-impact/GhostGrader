import type { LmsAssignment, LmsCourse, LmsGrade, LmsSubmission, LmsUser } from "../server/store";

/** The mock LMS UI reads only its own server. It knows nothing about Ghost Grader. */
export const LMS_API = import.meta.env.VITE_LMS_API ?? "http://localhost:8788/api/v1";
export const GHOST_GRADER_URL = import.meta.env.VITE_GHOST_GRADER_URL ?? "http://localhost:5174";

async function call<T>(path: string): Promise<T> {
  const res = await fetch(`${LMS_API}${path}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body && body.error) || `Request failed (${res.status})`);
  return body as T;
}

export const lms = {
  courses: () => call<LmsCourse[]>("/courses"),
  assignments: () => call<LmsAssignment[]>("/assignments"),
  assignment: (id: string) => call<LmsAssignment>(`/assignments/${encodeURIComponent(id)}`),
  users: () => call<LmsUser[]>("/users"),
  submissions: (id: string) => call<LmsSubmission[]>(`/assignments/${encodeURIComponent(id)}/submissions`),
  grades: (id: string) => call<LmsGrade[]>(`/assignments/${encodeURIComponent(id)}/grades`),
};
