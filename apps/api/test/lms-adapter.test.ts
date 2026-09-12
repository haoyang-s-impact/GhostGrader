import { describe, expect, it } from "vitest";
import { LmsError } from "../src/lms/adapter";
import { createCanvasAdapter } from "../src/lms/canvas";
import { createMockLmsAdapter } from "../src/lms/mock";
import { selectLmsAdapter } from "../src/lms/select";

type Reply = { status?: number; body: unknown };

/** Route-matching fake fetch: each path answers from its own queue. */
function fakeFetch(routes: Record<string, Reply[]>) {
  const calls: { url: string; method: string; headers: Record<string, string>; body: unknown }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const path = new URL(url).pathname.replace(/^\/api\/v1/, "");
    const queue = routes[`${init?.method ?? "GET"} ${path}`];
    const r = queue?.shift();
    if (!r) throw new Error(`unexpected ${init?.method ?? "GET"} ${path}`);
    return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const wireAssignment = {
  id: "lms-a-haber",
  course_id: "lms-c-chem101",
  course_name: "CHEM 101",
  name: "Equilibrium",
  description: "",
  questions: [
    { id: "lms-q-2", position: 2, name: "Pressure", question_text: "Explain pressure.", points_possible: 15 },
    { id: "lms-q-1", position: 1, name: "Reversibility", question_text: "Explain reversibility.", points_possible: 30 },
  ],
};
const wireSubmissions = [
  { id: "sub-04", assignment_id: "lms-a-haber", question_id: "lms-q-1", user_id: "stu-04", user_name: "Daniel Okafor", body: "Essay", submitted_at: "2026-09-10T12:00:00Z" },
];

describe("mock LMS adapter", () => {
  it("translates the LMS's snake_case shapes into a pull result, questions in position order", async () => {
    const { fetchImpl, calls } = fakeFetch({
      "GET /assignments/lms-a-haber": [{ body: wireAssignment }],
      "GET /courses/lms-c-chem101": [{ body: { id: "lms-c-chem101", name: "CHEM 101", term: "Fall 2026" } }],
      "GET /assignments/lms-a-haber/submissions": [{ body: wireSubmissions }],
    });
    const lms = createMockLmsAdapter({ baseUrl: "http://lms.test/api/v1/", apiKey: "secret", fetchImpl });
    const r = await lms.pullAssignment("lms-a-haber");

    expect(r.course).toEqual({ lmsId: "lms-c-chem101", name: "CHEM 101", term: "Fall 2026" });
    expect(r.questions.map((q) => [q.lmsId, q.index, q.pointsPossible])).toEqual([["lms-q-1", 1, 30], ["lms-q-2", 2, 15]]);
    expect(r.answers).toEqual([
      { lmsId: "sub-04", lmsQuestionId: "lms-q-1", lmsStudentId: "stu-04", studentName: "Daniel Okafor", text: "Essay", submittedAt: Date.parse("2026-09-10T12:00:00Z") },
    ]);
    // The trailing slash is stripped and the token is sent as a bearer.
    expect(calls[0]!.url).toBe("http://lms.test/api/v1/assignments/lms-a-haber");
    expect(calls[0]!.headers.authorization).toBe("Bearer secret");
  });

  it("lists assignments as summaries", async () => {
    const { fetchImpl } = fakeFetch({ "GET /assignments": [{ body: [wireAssignment] }] });
    const list = await createMockLmsAdapter({ fetchImpl }).listAssignments();
    expect(list).toEqual([{ lmsId: "lms-a-haber", courseName: "CHEM 101", title: "Equilibrium", questionCount: 2 }]);
  });

  it("pushes grades as one bulk body carrying client reference ids, and maps the receipts back", async () => {
    const { fetchImpl, calls } = fakeFetch({
      "POST /assignments/lms-a-haber/grades": [
        {
          body: {
            accepted: [{ id: "g-1", question_id: "lms-q-1", user_id: "stu-04", score: 20, comment: "Nice", graded_at: "2026-09-12T10:00:00Z", client_reference_id: "sub-04:20:x" }],
            rejected: [{ client_reference_id: "sub-11:18", reason: "not enrolled" }],
          },
        },
      ],
    });
    const r = await createMockLmsAdapter({ fetchImpl }).pushGrades("lms-a-haber", [
      { lmsQuestionId: "lms-q-1", lmsStudentId: "stu-04", points: 20, comment: "Nice", clientReferenceId: "sub-04:20:x" },
      { lmsQuestionId: "lms-q-1", lmsStudentId: "stu-11", points: 18, clientReferenceId: "sub-11:18" },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.body).toEqual({
      grades: [
        { question_id: "lms-q-1", user_id: "stu-04", score: 20, comment: "Nice", client_reference_id: "sub-04:20:x" },
        { question_id: "lms-q-1", user_id: "stu-11", score: 18, comment: "", client_reference_id: "sub-11:18" },
      ],
    });
    expect(r).toEqual({
      accepted: [{ clientReferenceId: "sub-04:20:x", lmsGradeId: "g-1", gradedAt: Date.parse("2026-09-12T10:00:00Z") }],
      rejected: [{ clientReferenceId: "sub-11:18", reason: "not enrolled" }],
    });
  });

  it("retries a 5xx exactly once, then succeeds", async () => {
    const { fetchImpl, calls } = fakeFetch({ "GET /assignments": [{ status: 503, body: "busy" }, { body: [] }] });
    expect(await createMockLmsAdapter({ fetchImpl }).listAssignments()).toEqual([]);
    expect(calls).toHaveLength(2);
  });

  it("gives up after the single retry and reports the error as retryable", async () => {
    const { fetchImpl, calls } = fakeFetch({ "GET /assignments": [{ status: 500, body: "boom" }, { status: 502, body: "still boom" }] });
    const err = await createMockLmsAdapter({ fetchImpl }).listAssignments().catch((e) => e);
    expect(err).toBeInstanceOf(LmsError);
    expect(err).toMatchObject({ retryable: true, status: 502 });
    expect(err.message).toMatch(/mock-lms 502: still boom/);
    expect(calls).toHaveLength(2);
  });

  it("does not retry a 4xx", async () => {
    const { fetchImpl, calls } = fakeFetch({ "GET /assignments/missing": [{ status: 404, body: "no such assignment" }] });
    const err = await createMockLmsAdapter({ fetchImpl }).pullAssignment("missing").catch((e) => e);
    expect(err).toMatchObject({ retryable: false, status: 404 });
    expect(calls).toHaveLength(1);
  });

  it("treats a response in the wrong shape as retryable", async () => {
    const { fetchImpl, calls } = fakeFetch({ "GET /assignments": [{ body: { not: "a list" } }, { body: [{ nope: true }] }] });
    const err = await createMockLmsAdapter({ fetchImpl }).listAssignments().catch((e) => e);
    expect(err).toMatchObject({ retryable: true });
    expect(err.message).toMatch(/unexpected shape/);
    expect(calls).toHaveLength(2);
  });

  it("reports an unreachable LMS as retryable", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const err = await createMockLmsAdapter({ fetchImpl, baseUrl: "http://down.test/api/v1" }).listAssignments().catch((e) => e);
    expect(err).toMatchObject({ retryable: true });
    expect(err.message).toMatch(/Could not reach the LMS at http:\/\/down\.test/);
  });
});

describe("Canvas adapter stub", () => {
  it("fails loudly and without retrying rather than pretending to work", async () => {
    const canvas = createCanvasAdapter({ baseUrl: "https://school.instructure.com/api/v1", token: "t" });
    expect(canvas.name).toBe("canvas");
    await expect(canvas.listAssignments()).rejects.toMatchObject({ retryable: false, message: expect.stringMatching(/not implemented/) });
  });
});

describe("selectLmsAdapter", () => {
  it("defaults to the mock LMS and switches to Canvas on request", () => {
    expect(selectLmsAdapter({}).name).toBe("mock");
    expect(selectLmsAdapter({ GG_LMS: "mock" }).name).toBe("mock");
    expect(selectLmsAdapter({ GG_LMS: "canvas" }).name).toBe("canvas");
  });
});
