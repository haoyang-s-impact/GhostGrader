import { describe, expect, it } from "vitest";
import { assignment, submissions, type AnalysisResult, type Assignment, type Decision } from "@gg/shared";
import { selectAnalyzer } from "../src/analyzer";
import { createApp } from "../src/app";
import { Store } from "../src/store";

const T1 = "t-demo";
const T2 = "t-second";

function mkApp() {
  return createApp({ analyzer: selectAnalyzer({ GG_MOCK: "1", NODE_ENV: "test" }), store: new Store() });
}
type App = ReturnType<typeof mkApp>;

function sub(index: number) {
  return submissions.find((s) => s.index === index)!;
}

function decision(index: number, points: number, missing: string[], id = `d${index}`): Decision {
  return {
    id,
    assignmentId: assignment.id,
    submissionId: sub(index).id,
    submissionIndex: index,
    criterionId: "reversibility",
    points,
    deduction: 5 - points,
    missingConcepts: missing,
    at: index,
  };
}

const hdr = (teacher: string) => ({ "content-type": "application/json", "x-teacher-id": teacher });
const post = (app: App, path: string, body: unknown, teacher = T1) =>
  app.request(path, { method: "POST", headers: hdr(teacher), body: JSON.stringify(body) });
const put = (app: App, path: string, body: unknown, teacher = T1) =>
  app.request(path, { method: "PUT", headers: hdr(teacher), body: JSON.stringify(body) });
const get = (app: App, path: string, teacher = T1) => app.request(path, { headers: hdr(teacher) });

describe("auth and health", () => {
  it("reports the analyzer mode without a teacher header", async () => {
    const res = await mkApp().request("/health");
    expect(await res.json()).toEqual({ ok: true, analyzer: "mock" });
  });

  it("rejects scoped routes without a known teacher", async () => {
    const app = mkApp();
    expect((await app.request("/lms/courses")).status).toBe(401);
    expect((await get(app, "/lms/courses", "nobody")).status).toBe(401);
  });
});

describe("multi-tenant LMS data", () => {
  it("seeds one course and assignment per teacher and keeps them separate", async () => {
    const app = mkApp();
    const c1 = await (await get(app, "/lms/courses")).json();
    const c2 = await (await get(app, "/lms/courses", T2)).json();
    expect(c1.map((c: { id: string }) => c.id)).toEqual(["c-chem101"]);
    expect(c2.map((c: { id: string }) => c.id)).toEqual(["c-hist210"]);
    expect((await get(app, `/lms/assignments/${assignment.id}`)).status).toBe(200);
    expect((await get(app, `/lms/assignments/${assignment.id}`, T2)).status).toBe(404);
    expect((await get(app, `/lms/assignments/${assignment.id}/submissions`, T2)).status).toBe(404);
  });

  it("lets a teacher define a course, an assignment with its own rubric, and submissions, then analyzes against that rubric", async () => {
    const app = mkApp();
    const course = await (await post(app, "/lms/courses", { name: "HIST 210: Modern Europe", term: "Fall 2026" }, T2)).json();
    expect(course.teacherId).toBe(T2);

    const input = {
      courseId: course.id,
      title: "Causes of the First World War",
      prompt: "Explain how alliance systems and nationalism contributed to the outbreak of war in 1914.",
      learningObjectives: ["Connect long-term causes to the July Crisis."],
      anchors: [],
      rubric: {
        id: "r-ww1",
        criteria: [
          {
            id: "alliances",
            title: "Alliance systems",
            description: "Explains how the alliance blocs turned a regional crisis into a general war.",
            maxPoints: 10,
            concepts: ["alliance", "escalation"],
            bands: [
              { level: "Exemplary", points: 10, descriptor: "Explains both blocs and the escalation mechanism." },
              { level: "Proficient", points: 7, descriptor: "Names the blocs with partial mechanism." },
              { level: "Beginning", points: 0, descriptor: "Alliances not addressed." },
            ],
          },
          {
            id: "nationalism",
            title: "Nationalism",
            description: "Explains the role of nationalism in the Balkans and the great powers.",
            maxPoints: 10,
            concepts: ["nationalism", "balkans"],
            bands: [
              { level: "Exemplary", points: 10, descriptor: "Links Balkan nationalism to great-power rivalry." },
              { level: "Proficient", points: 7, descriptor: "Describes nationalism generally." },
              { level: "Beginning", points: 0, descriptor: "Nationalism not addressed." },
            ],
          },
        ],
      },
    };
    const created = await post(app, "/lms/assignments", input, T2);
    expect(created.status).toBe(201);
    const a = (await created.json()) as Assignment;
    expect(a.teacherId).toBe(T2);
    expect(a.course).toBe("HIST 210: Modern Europe");
    expect((await get(app, `/lms/assignments/${a.id}`, T1)).status).toBe(404);

    const s = await (await post(app, `/lms/assignments/${a.id}/submissions`, { studentName: "Ada Lovelace", text: "The alliance blocs meant that a regional crisis caused escalation across the whole continent within weeks." }, T2)).json();
    expect(s.index).toBe(1);

    const res = await post(app, "/analyze", { assignmentId: a.id, submission: { id: s.id, index: s.index, studentName: s.studentName, text: s.text } }, T2);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnalysisResult;
    expect(body.criteria.map((c) => c.criterionId)).toEqual(["alliances", "nationalism"]);
    const alliances = body.criteria[0]!;
    expect(alliances.suggestedPoints).toBe(10);
    const nationalism = body.criteria[1]!;
    expect(nationalism.missingConcepts).toContain("balkans");
    expect(nationalism.suggestedPoints).toBeLessThan(10);
    expect(body.feedbackDraft.startsWith("Ada,")).toBe(true);

    // The other teacher cannot analyze against this rubric.
    expect((await post(app, "/analyze", { assignmentId: a.id, submission: s }, T1)).status).toBe(404);
  });

  it("validates rubrics on create and update", async () => {
    const app = mkApp();
    const bad = { courseId: "c-chem101", title: "x", prompt: "y", learningObjectives: [], anchors: [], rubric: { id: "r", criteria: [] } };
    const res = await post(app, "/lms/assignments", bad);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/at least one criterion/);

    const existing = (await (await get(app, `/lms/assignments/${assignment.id}`)).json()) as Assignment;
    const { id: _i, teacherId: _t, course: _c, updatedAt: _u, ...editable } = existing;
    const renamed = { ...editable, title: "Renamed" };
    const upd = await put(app, `/lms/assignments/${assignment.id}`, renamed);
    expect(upd.status).toBe(200);
    expect((await upd.json()).title).toBe("Renamed");
    expect((await put(app, `/lms/assignments/${assignment.id}`, renamed, T2)).status).toBe(404);
  });
});

describe("POST /analyze on the seeded assignment", () => {
  it("returns a rubric-aligned result with suggested points and the reversibility omission on submission 4", async () => {
    const res = await post(mkApp(), "/analyze", { assignmentId: assignment.id, submission: sub(4) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnalysisResult;
    expect(body.criteria).toHaveLength(6);
    const rev = body.criteria.find((c) => c.criterionId === "reversibility")!;
    expect(rev.missingConcepts).toContain("reversibility");
    expect(rev.suggestedPoints).toBe(0);
    expect(body.criteria.find((c) => c.criterionId === "le_chatelier")!.suggestedPoints).toBe(5);
    expect(body.feedbackDraft).toMatch(/^Daniel,/);
  });

  it("rejects malformed bodies and unknown assignments", async () => {
    const app = mkApp();
    expect((await post(app, "/analyze", { nope: true })).status).toBe(400);
    expect((await post(app, "/analyze", { assignmentId: "other", submission: sub(1) })).status).toBe(404);
  });
});

describe("decision flow", () => {
  it("raises the demo alert on submission 11 after submission 4, and override silences it", async () => {
    const app = mkApp();
    let res = await post(app, "/decision", { decision: decision(4, 2.5, ["reversibility", "dynamic_equilibrium"]) });
    expect((await res.json()).alert).toBeNull();

    res = await post(app, "/decision", { decision: decision(11, 0, ["reversibility", "dynamic_equilibrium"]) });
    const { alert } = await res.json();
    expect(alert).toMatchObject({ priorSubmissionIndex: 4, currentSubmissionIndex: 11, sharedConcept: "reversibility", priorDeduction: 2.5, currentDeduction: 5, spread: 2.5 });

    expect((await post(app, "/override", { assignmentId: assignment.id, decisionIdA: "d11", decisionIdB: "d4" })).status).toBe(204);
    res = await post(app, "/decision", { decision: decision(11, 0, ["reversibility"], "d11") });
    expect((await res.json()).alert).toBeNull();

    expect((await post(app, "/check-raised", { assignmentId: assignment.id })).status).toBe(204);
    expect((await post(app, "/check-approved", { assignmentId: assignment.id })).status).toBe(204);

    const session = await (await get(app, `/session/${assignment.id}`)).json();
    expect(session.decisions).toHaveLength(3);
    expect(session).toMatchObject({ alertsRaised: 1, checksRaised: 1, checksApproved: 1 });
    expect(session.overrides).toBeUndefined();

    // Another teacher cannot read or record into this session.
    expect((await get(app, `/session/${assignment.id}`, T2)).status).toBe(404);
    expect((await post(app, "/decision", { decision: decision(1, 5, []) }, T2)).status).toBe(404);
  });

  it("rejects decisions on unknown criteria", async () => {
    const res = await post(mkApp(), "/decision", { decision: { ...decision(1, 5, []), criterionId: "nope" } });
    expect(res.status).toBe(404);
  });

  it("allows CORS from the mock LMS origin and from extensions", async () => {
    const app = mkApp();
    for (const origin of ["http://localhost:5173", "chrome-extension://abcdefghijklmnop"]) {
      const res = await app.request("/health", { headers: { Origin: origin } });
      expect(res.headers.get("access-control-allow-origin")).toBe(origin);
    }
    const res = await app.request("/health", { headers: { Origin: "https://evil.example" } });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("Store persistence", () => {
  it("round-trips through a JSON file", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const path = join(mkdtempSync(join(tmpdir(), "gg-store-")), "data.json");
    const s1 = new Store(path);
    const course = s1.createCourse(T1, "Persisted", "");
    const s2 = new Store(path);
    expect(s2.course(T1, course.id)?.name).toBe("Persisted");
  });
});
