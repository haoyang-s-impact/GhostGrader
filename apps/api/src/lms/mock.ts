import { z } from "zod";
import { LmsError, withOneRetry, type LmsAdapter, type PushGrade } from "./adapter";

/**
 * HTTP client for the mock LMS server in apps/mock-lms. Its API is shaped like
 * a foreign system (snake_case, points_possible, ISO timestamps) so this
 * adapter does real translation, the same job a Canvas adapter would do.
 */
export interface MockLmsAdapterOptions {
  baseUrl?: string;
  apiKey?: string;
  log?: (msg: string) => void;
  fetchImpl?: typeof fetch;
}

export const LMS_BASE_URLS = {
  mock: "http://localhost:8788/api/v1",
} as const;

const WireCourse = z.object({ id: z.string(), name: z.string(), term: z.string().default("") });
const WireQuestion = z.object({
  id: z.string(),
  position: z.number(),
  name: z.string().default(""),
  question_text: z.string(),
  points_possible: z.number(),
});
const WireAssignment = z.object({
  id: z.string(),
  course_id: z.string(),
  course_name: z.string().default(""),
  name: z.string(),
  description: z.string().default(""),
  questions: z.array(WireQuestion),
});
const WireSubmission = z.object({
  id: z.string(),
  assignment_id: z.string(),
  question_id: z.string(),
  user_id: z.string(),
  user_name: z.string(),
  body: z.string(),
  submitted_at: z.string(),
});
const WireReceipt = z.object({
  id: z.string(),
  question_id: z.string(),
  user_id: z.string(),
  score: z.number(),
  comment: z.string().default(""),
  graded_at: z.string(),
  client_reference_id: z.string(),
});
const WirePushResponse = z.object({
  accepted: z.array(WireReceipt),
  rejected: z.array(z.object({ client_reference_id: z.string(), reason: z.string() })),
});

export function createMockLmsAdapter(opts: MockLmsAdapterOptions = {}): LmsAdapter {
  const baseUrl = (opts.baseUrl ?? LMS_BASE_URLS.mock).replace(/\/$/, "");
  const doFetch = opts.fetchImpl ?? fetch;

  async function call<T>(schema: z.ZodType<T>, path: string, init?: { method: string; body: unknown }): Promise<T> {
    let res: Response;
    try {
      res = await doFetch(`${baseUrl}${path}`, {
        method: init?.method ?? "GET",
        headers: {
          "content-type": "application/json",
          ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
        },
        body: init ? JSON.stringify(init.body) : undefined,
      });
    } catch (err) {
      throw new LmsError(`Could not reach the LMS at ${baseUrl}: ${err instanceof Error ? err.message : String(err)}`, true);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new LmsError(`mock-lms ${res.status}: ${text.slice(0, 200)}`, res.status === 429 || res.status >= 500, res.status);
    }
    const parsed = schema.safeParse(await res.json().catch(() => undefined));
    if (!parsed.success) throw new LmsError(`mock-lms returned an unexpected shape for ${path}.`, true);
    return parsed.data;
  }

  return {
    name: "mock",

    listAssignments: () =>
      withOneRetry(async () => {
        const list = await call(z.array(WireAssignment), "/assignments");
        return list.map((a) => ({ lmsId: a.id, courseName: a.course_name, title: a.name, questionCount: a.questions.length }));
      }),

    pullAssignment: (lmsAssignmentId) =>
      withOneRetry(async () => {
        const a = await call(WireAssignment, `/assignments/${encodeURIComponent(lmsAssignmentId)}`);
        const [course, submissions] = await Promise.all([
          call(WireCourse, `/courses/${encodeURIComponent(a.course_id)}`),
          call(z.array(WireSubmission), `/assignments/${encodeURIComponent(a.id)}/submissions`),
        ]);
        opts.log?.(`[lms:mock] pulled ${a.id}: ${a.questions.length} questions, ${submissions.length} answers`);
        return {
          course: { lmsId: course.id, name: course.name, term: course.term },
          assignment: { lmsId: a.id, title: a.name, description: a.description },
          questions: [...a.questions]
            .sort((x, y) => x.position - y.position)
            .map((q) => ({ lmsId: q.id, index: q.position, title: q.name, prompt: q.question_text, pointsPossible: q.points_possible })),
          answers: submissions.map((s) => ({
            lmsId: s.id,
            lmsQuestionId: s.question_id,
            lmsStudentId: s.user_id,
            studentName: s.user_name,
            text: s.body,
            submittedAt: Date.parse(s.submitted_at) || 0,
          })),
        };
      }),

    pushGrades: (lmsAssignmentId, grades: PushGrade[]) =>
      withOneRetry(async () => {
        const res = await call(WirePushResponse, `/assignments/${encodeURIComponent(lmsAssignmentId)}/grades`, {
          method: "POST",
          body: {
            grades: grades.map((g) => ({
              question_id: g.lmsQuestionId,
              user_id: g.lmsStudentId,
              score: g.points,
              comment: g.comment ?? "",
              client_reference_id: g.clientReferenceId,
            })),
          },
        });
        opts.log?.(`[lms:mock] pushed ${lmsAssignmentId}: ${res.accepted.length} accepted, ${res.rejected.length} rejected`);
        return {
          accepted: res.accepted.map((r) => ({ clientReferenceId: r.client_reference_id, lmsGradeId: r.id, gradedAt: Date.parse(r.graded_at) || 0 })),
          rejected: res.rejected.map((r) => ({ clientReferenceId: r.client_reference_id, reason: r.reason })),
        };
      }),
  };
}
