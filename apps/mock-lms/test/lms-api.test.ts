import { describe, expect, it } from "vitest";
import { answers, assignment } from "@gg/shared";
import { createLmsApp } from "../server/app";
import { LmsStore, seedLmsData } from "../server/store";

const A = assignment.lmsAssignmentId;

function mk() {
  const store = new LmsStore();
  const app = createLmsApp({ store });
  const get = (path: string) => app.request(`/api/v1${path}`);
  const post = (path: string, body: unknown) =>
    app.request(`/api/v1${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { app, store, get, post };
}

const grade = (question_id: string, user_id: string, score: number, ref = `${question_id}|${user_id}:${score}`, comment?: string) => ({
  question_id,
  user_id,
  score,
  client_reference_id: ref,
  ...(comment ? { comment } : {}),
});

describe("seed", () => {
  it("holds the demo course, both questions with points possible, and one submission per answer", () => {
    const data = seedLmsData();
    expect(data.courses).toHaveLength(1);
    const a = data.assignments[0]!;
    expect(a.questions.map((q) => [q.id, q.position, q.points_possible])).toEqual([
      ["lms-q-haber-1", 1, 30],
      ["lms-q-haber-2", 2, 15],
    ]);
    expect(data.submissions).toHaveLength(answers.length);
    expect(data.users).toHaveLength(15);
  });

  it("starts with an empty gradebook", () => {
    expect(seedLmsData().grades).toEqual([]);
  });

  it("never exposes rubrics: the LMS only knows what a question is worth", () => {
    expect(JSON.stringify(seedLmsData())).not.toContain("criteria");
  });
});

describe("read API", () => {
  it("serves courses, assignments and one submission row per (student, question)", async () => {
    const { get } = mk();
    expect((await (await get("/courses")).json())[0].id).toBe("lms-c-chem101");
    expect((await get("/courses/lms-c-chem101")).status).toBe(200);
    expect((await get("/courses/nope")).status).toBe(404);
    expect((await (await get("/courses/lms-c-chem101/assignments")).json())).toHaveLength(1);

    const subs = await (await get(`/assignments/${A}/submissions`)).json();
    expect(subs).toHaveLength(20);
    const cells = new Set(subs.map((s: { question_id: string; user_id: string }) => `${s.question_id}|${s.user_id}`));
    expect(cells.size).toBe(20);
    expect((await get("/assignments/nope/submissions")).status).toBe(404);
  });
});

describe("grade upsert", () => {
  it("records grades and reflects them in the gradebook", async () => {
    const { get, post } = mk();
    const res = await (await post(`/assignments/${A}/grades`, { grades: [grade("lms-q-haber-1", "stu-04", 20, "r1", "Explain reversibility.")] })).json();
    expect(res.rejected).toEqual([]);
    expect(res.accepted[0]).toMatchObject({ question_id: "lms-q-haber-1", user_id: "stu-04", score: 20, comment: "Explain reversibility.", client_reference_id: "r1" });

    const book = await (await get(`/assignments/${A}/grades`)).json();
    expect(book).toHaveLength(1);
  });

  it("is a no-op for a repeated client reference, returning the same receipt", async () => {
    const { get, post } = mk();
    const first = await (await post(`/assignments/${A}/grades`, { grades: [grade("lms-q-haber-1", "stu-04", 20, "r1")] })).json();
    const again = await (await post(`/assignments/${A}/grades`, { grades: [grade("lms-q-haber-1", "stu-04", 20, "r1")] })).json();
    expect(again.accepted[0]).toEqual(first.accepted[0]);
    expect(await (await get(`/assignments/${A}/grades`)).json()).toHaveLength(1);
  });

  it("keeps one grade per cell: a new reference overwrites the score under the same grade id", async () => {
    const { get, post } = mk();
    const first = await (await post(`/assignments/${A}/grades`, { grades: [grade("lms-q-haber-1", "stu-11", 22, "r1")] })).json();
    const second = await (await post(`/assignments/${A}/grades`, { grades: [grade("lms-q-haber-1", "stu-11", 18, "r2")] })).json();
    expect(second.accepted[0].id).toBe(first.accepted[0].id);
    const book = await (await get(`/assignments/${A}/grades`)).json();
    expect(book).toHaveLength(1);
    expect(book[0].score).toBe(18);
  });

  it("rejects a grade for a question outside the assignment or a student with no submission", async () => {
    const { post } = mk();
    const res = await (
      await post(`/assignments/${A}/grades`, {
        grades: [grade("lms-q-other", "stu-04", 5, "bad-q"), grade("lms-q-haber-2", "stu-02", 5, "no-sub"), grade("lms-q-haber-2", "stu-04", 9, "ok")],
      })
    ).json();
    expect(res.accepted.map((g: { client_reference_id: string }) => g.client_reference_id)).toEqual(["ok"]);
    expect(res.rejected.map((r: { client_reference_id: string }) => r.client_reference_id)).toEqual(["bad-q", "no-sub"]);
  });

  it("validates the body and the assignment", async () => {
    const { post } = mk();
    expect((await post(`/assignments/${A}/grades`, { grades: [{ score: "high" }] })).status).toBe(400);
    expect((await post("/assignments/nope/grades", { grades: [] })).status).toBe(404);
  });

  it("can clear an assignment's gradebook to rerun a demo", async () => {
    const { app, get, post } = mk();
    await post(`/assignments/${A}/grades`, { grades: [grade("lms-q-haber-1", "stu-04", 20)] });
    expect((await app.request(`/api/v1/assignments/${A}/grades`, { method: "DELETE" })).status).toBe(204);
    expect(await (await get(`/assignments/${A}/grades`)).json()).toEqual([]);
  });
});
