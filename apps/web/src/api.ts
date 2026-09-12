import {
  AnalysisResultSchema,
  DriftAlertSchema,
  type AnalysisResult,
  type Answer,
  type Assignment,
  type AssignmentGrade,
  type AssignmentInput,
  type Course,
  type Decision,
  type DriftAlert,
  type SyncSummary,
  type Teacher,
} from "@gg/shared";
import { z } from "zod";

export const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8787";
const TIMEOUT_MS = 45_000;
const TEACHER_KEY = "gg-teacher";

/** The API scopes everything by teacher. A real deployment replaces this with a login. */
export function currentTeacherId(): string {
  return localStorage.getItem(TEACHER_KEY) ?? "t-demo";
}
export function setCurrentTeacherId(id: string) {
  localStorage.setItem(TEACHER_KEY, id);
}

export class ApiError extends Error {
  constructor(message: string, public readonly retryable: boolean, public readonly status?: number) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}, schema?: z.ZodType<T>): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { "content-type": "application/json", "x-teacher-id": currentTeacherId(), ...(init.headers ?? {}) },
      signal: ctrl.signal,
    });
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === "AbortError";
    throw new ApiError(aborted ? "The request timed out." : `Could not reach the Ghost Grader API at ${API_BASE}. Is it running?`, true);
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (body && typeof body.error === "string" && body.error) || `Server error (${res.status})`;
    const retryable = body && typeof body.retryable === "boolean" ? body.retryable : res.status >= 500;
    throw new ApiError(msg, retryable, res.status);
  }
  return schema ? schema.parse(body) : (body as T);
}

const json = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export interface Health {
  ok: boolean;
  analyzer: "claude" | "openrouter" | "openai" | "mock";
  model?: string;
  lms: string | null;
}

export interface SessionSummary {
  decisions: Decision[];
  alertsRaised: number;
  alertsAligned: number;
  checksRaised: number;
  checksApproved: number;
}

export type SyncStatus = { linked: false; lms: null } | ({ linked: true; lmsAssignmentId: string; lastPulledAt: number; answers: number } & SyncSummary);

export const api = {
  health: () => request<Health>("/health"),
  teachers: () => request<Teacher[]>("/teachers"),
  courses: () => request<Course[]>("/courses"),
  assignments: () => request<Assignment[]>("/assignments"),
  assignment: (id: string) => request<Assignment>(`/assignments/${encodeURIComponent(id)}`),
  createAssignment: (input: AssignmentInput) => request<Assignment>("/assignments", json(input)),
  updateAssignment: (id: string, input: AssignmentInput) => request<Assignment>(`/assignments/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(input) }),
  answers: (assignmentId: string) => request<Answer[]>(`/assignments/${encodeURIComponent(assignmentId)}/answers`),
  grades: (assignmentId: string) => request<AssignmentGrade[]>(`/assignments/${encodeURIComponent(assignmentId)}/grades`),

  analyze: (assignmentId: string, questionId: string, answerId: string) =>
    request("/analyze", json({ assignmentId, questionId, answerId }), AnalysisResultSchema),
  decision: (decision: Decision) => request("/decision", json({ decision }), z.object({ alert: DriftAlertSchema.nullable() })),
  override: (assignmentId: string, decisionIdA: string, decisionIdB: string) => request<void>("/override", json({ assignmentId, decisionIdA, decisionIdB })),
  aligned: (assignmentId: string) => request<void>("/aligned", json({ assignmentId })),
  checkRaised: (assignmentId: string, answerId?: string) => request<void>("/check-raised", json({ assignmentId, answerId })),
  checkApproved: (assignmentId: string) => request<void>("/check-approved", json({ assignmentId })),
  session: (assignmentId: string) => request<SessionSummary>(`/session/${encodeURIComponent(assignmentId)}`),

  syncStatus: (assignmentId: string) => request<SyncStatus>(`/sync/status/${encodeURIComponent(assignmentId)}`),
  push: (assignmentId: string) => request<{ summary: SyncSummary }>("/sync/push", json({ assignmentId })),
};

export type { AnalysisResult, DriftAlert };
