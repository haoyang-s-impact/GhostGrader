import { AnalysisResultSchema, DriftAlertSchema, type AnalysisResult, type Decision, type DriftAlert } from "@gg/shared";
import { z } from "zod";
import type { Settings } from "../settings";
import type { PageAttempt, PageContext } from "./moodle";

const TIMEOUT_MS = 60_000;

export class ApiError extends Error {
  constructor(message: string, public readonly retryable: boolean, public readonly status?: number) {
    super(message);
  }
}

export interface SessionSummary {
  decisions: Decision[];
  alertsRaised: number;
  alertsAligned: number;
  checksRaised: number;
  checksApproved: number;
}

const PageSyncResponse = z.object({
  assignmentId: z.string(),
  questionId: z.string(),
  rubricDrafted: z.boolean(),
  rubricSource: z.enum(["model", "parsed"]).nullable(),
  question: z.object({ id: z.string(), title: z.string(), totalPoints: z.number().optional(), rubric: z.object({ criteria: z.array(z.object({ id: z.string(), title: z.string(), maxPoints: z.number(), concepts: z.array(z.string()) })) }) }),
  answers: z.record(z.string(), z.object({ answerId: z.string(), studentId: z.string(), studentIndex: z.number() })),
});
export type PageSyncResponse = z.infer<typeof PageSyncResponse>;

export function createApi(settings: Settings) {
  async function request<T>(path: string, init: RequestInit, schema?: z.ZodType<T>): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${settings.apiBase}${path}`, {
        ...init,
        headers: { "content-type": "application/json", "x-teacher-id": settings.teacherId, ...(init.headers ?? {}) },
        signal: ctrl.signal,
      });
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === "AbortError";
      throw new ApiError(aborted ? "The request timed out." : `Could not reach the Ghost Grader API at ${settings.apiBase}.`, true);
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

  return {
    health: () => request<{ ok: boolean; analyzer: string; model?: string }>("/health", { method: "GET" }),

    syncPage: (context: PageContext, attempts: PageAttempt[]) =>
      request(
        "/lms/moodle/page",
        {
          method: "POST",
          body: JSON.stringify({
            lms: "moodle",
            course: { lmsId: context.courseLmsId || "unknown", name: context.courseName },
            quiz: { lmsId: context.quizLmsId || "unknown", name: context.quizName },
            question: { lmsId: context.questionLmsId || `slot-${context.slot}`, slot: context.slot, title: context.questionTitle, text: context.questionText, maxMark: context.maxMark || 1, graderInfo: context.graderInfo },
            attempts: attempts.map((a) => ({ lmsId: a.lmsId, attemptNumber: a.attemptNumber, studentName: a.studentName, studentEmail: a.studentEmail, text: a.text })),
          }),
        },
        PageSyncResponse,
      ),

    analyze: (assignmentId: string, questionId: string, answerId: string) =>
      request("/analyze", { method: "POST", body: JSON.stringify({ assignmentId, questionId, answerId }) }, AnalysisResultSchema),

    decision: (decision: Decision) =>
      request("/decision", { method: "POST", body: JSON.stringify({ decision }) }, z.object({ alert: DriftAlertSchema.nullable() })),

    override: (assignmentId: string, decisionIdA: string, decisionIdB: string) =>
      request<void>("/override", { method: "POST", body: JSON.stringify({ assignmentId, decisionIdA, decisionIdB }) }),

    aligned: (assignmentId: string) => request<void>("/aligned", { method: "POST", body: JSON.stringify({ assignmentId }) }),
    checkRaised: (assignmentId: string, answerId: string) => request<void>("/check-raised", { method: "POST", body: JSON.stringify({ assignmentId, answerId }) }),
    checkApproved: (assignmentId: string) => request<void>("/check-approved", { method: "POST", body: JSON.stringify({ assignmentId }) }),

    session: (assignmentId: string) => request<SessionSummary>(`/session/${assignmentId}`, { method: "GET" }),
  };
}

export type Api = ReturnType<typeof createApi>;
export type { AnalysisResult, DriftAlert };
