import { AnalysisResultSchema, DriftAlertSchema, type AnalysisResult, type Decision, type DriftAlert, type Submission } from "@gg/shared";
import { z } from "zod";

export const API_BASE = "http://localhost:8787";
const TIMEOUT_MS = 45_000;

/** Set from the page's data-gg-teacher-id; the API scopes everything by it. */
let teacherId: string | null = null;
export function setTeacherId(id: string | null) {
  teacherId = id;
}

export class ApiError extends Error {
  constructor(message: string, public readonly retryable: boolean, public readonly status?: number) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit, schema?: z.ZodType<T>): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(teacherId ? { "x-teacher-id": teacherId } : {}), ...(init.headers ?? {}) },
      signal: ctrl.signal,
    });
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === "AbortError";
    throw new ApiError(aborted ? "The analysis timed out." : "Could not reach the Ghost Grader server. Is it running on port 8787?", true);
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

export const api = {
  health: () => request<{ ok: boolean; analyzer: "claude" | "mock" }>("/health", { method: "GET" }),

  analyze: (assignmentId: string, submission: Submission) =>
    request("/analyze", { method: "POST", body: JSON.stringify({ assignmentId, submission }) }, AnalysisResultSchema),

  decision: (decision: Decision) =>
    request("/decision", { method: "POST", body: JSON.stringify({ decision }) }, z.object({ alert: DriftAlertSchema.nullable() })),

  override: (assignmentId: string, decisionIdA: string, decisionIdB: string) =>
    request<void>("/override", { method: "POST", body: JSON.stringify({ assignmentId, decisionIdA, decisionIdB }) }),

  aligned: (assignmentId: string) => request<void>("/aligned", { method: "POST", body: JSON.stringify({ assignmentId }) }),
  checkRaised: (assignmentId: string) => request<void>("/check-raised", { method: "POST", body: JSON.stringify({ assignmentId }) }),
  checkApproved: (assignmentId: string) => request<void>("/check-approved", { method: "POST", body: JSON.stringify({ assignmentId }) }),

  session: (assignmentId: string) =>
    request<SessionSummary>(`/session/${assignmentId}`, { method: "GET" }),
};

export interface SessionSummary {
  decisions: Decision[];
  alertsRaised: number;
  alertsAligned: number;
  checksRaised: number;
  checksApproved: number;
}

export type { AnalysisResult, DriftAlert };
