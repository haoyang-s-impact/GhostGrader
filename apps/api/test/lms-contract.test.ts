import { describe, expect, it } from "vitest";
import { assignment, pushReference } from "@gg/shared";
import { createLmsApp } from "../../mock-lms/server/app";
import { LmsStore } from "../../mock-lms/server/store";
import { selectAnalyzer } from "../src/analyzer";
import { createApp } from "../src/app";
import { createMockLmsAdapter } from "../src/lms/mock";
import { Store } from "../src/store";

/**
 * Contract test across the seam: Ghost Grader's real mock-LMS adapter talking
 * to the real mock LMS server, in process. The fake LMS in the other tests
 * checks sync logic; this checks that both sides agree on the wire format.
 */
function wired() {
  const lmsStore = new LmsStore();
  const lmsApp = createLmsApp({ store: lmsStore });
  const fetchImpl = ((input: string, init?: RequestInit) => lmsApp.request(input, init)) as unknown as typeof fetch;
  const adapter = createMockLmsAdapter({ baseUrl: "http://lms.local/api/v1", fetchImpl });
  const app = createApp({ analyzer: selectAnalyzer({ GG_MOCK: "1", NODE_ENV: "test" }), store: new Store(), lms: adapter });
  const hdr = { "content-type": "application/json", "x-teacher-id": "t-demo" };
  const post = (path: string, body: unknown) => app.request(path, { method: "POST", headers: hdr, body: JSON.stringify(body) });
  const get = (path: string) => app.request(path, { headers: hdr });
  return { adapter, lmsStore, post, get };
}

describe("adapter against the mock LMS server", () => {
  it("lists the LMS's assignments", async () => {
    const { adapter } = wired();
    expect(await adapter.listAssignments()).toEqual([
      { lmsId: "lms-a-haber", courseName: assignment.course, title: assignment.title, questionCount: 2 },
    ]);
  });

  it("round-trips: pull answers, grade one, push, and the grade lands in the LMS gradebook", async () => {
    const { lmsStore, post, get } = wired();

    const pulled = await (await post("/sync/pull", { lmsAssignmentId: "lms-a-haber" })).json();
    expect(pulled.answers).toMatchObject({ created: 20, skipped: 0 });

    // Grade Daniel's question 1 answer, going through analysis the way the web app does.
    const analysis = await (await post("/analyze", { assignmentId: assignment.id, questionId: "q-haber-1", answerId: "sub-04" })).json();
    expect(analysis.suggestedTotal).toBe(20.5);
    const answer = (await (await get(`/assignments/${assignment.id}/answers?questionId=q-haber-1`)).json()).find((a: { id: string }) => a.id === "sub-04");
    const decision = {
      id: "sub-04:grade",
      assignmentId: assignment.id,
      questionId: "q-haber-1",
      answerId: "sub-04",
      studentId: answer.studentId,
      studentIndex: answer.studentIndex,
      studentName: answer.studentName,
      points: 20.5,
      maxPoints: 30,
      suggestedPoints: analysis.suggestedTotal,
      missingConcepts: analysis.missingConcepts,
      comment: analysis.feedbackDraft,
      at: 1,
    };
    expect((await post("/decision", { decision })).status).toBe(200);
    expect(lmsStore.grades("lms-a-haber")).toEqual([]);

    const pushed = await (await post("/sync/push", { assignmentId: assignment.id })).json();
    expect(pushed.summary).toEqual({ graded: 1, pushed: 1, pending: 0, failed: 0 });

    const book = lmsStore.grades("lms-a-haber");
    expect(book).toHaveLength(1);
    expect(book[0]).toMatchObject({
      question_id: "lms-q-haber-1",
      user_id: "stu-04",
      score: 20.5,
      comment: analysis.feedbackDraft,
      client_reference_id: pushReference("sub-04", 20.5, analysis.feedbackDraft),
    });
    expect(pushed.pushed[0].lmsGradeId).toBe(book[0]!.id);

    // A second push sends nothing and the gradebook is unchanged.
    const again = await (await post("/sync/push", { assignmentId: assignment.id })).json();
    expect(again.pushed).toEqual([]);
    expect(lmsStore.grades("lms-a-haber")).toEqual(book);
  });

  it("surfaces an LMS 404 on pull as a non-retryable failure", async () => {
    const { post } = wired();
    const res = await post("/sync/pull", { lmsAssignmentId: "does-not-exist" });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ retryable: false, error: expect.stringMatching(/mock-lms 404/) });
  });
});
