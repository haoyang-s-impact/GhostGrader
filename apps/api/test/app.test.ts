import { describe, expect, it } from "vitest";
import { assignment, submissions, type AnalysisResult, type Decision } from "@gg/shared";
import { selectAnalyzer } from "../src/analyzer";
import { createApp } from "../src/app";
import { SessionStore } from "../src/session";

function mkApp() {
  return createApp({ analyzer: selectAnalyzer({ GG_MOCK: "1", NODE_ENV: "test" }), store: new SessionStore() });
}

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

async function post(app: ReturnType<typeof mkApp>, path: string, body: unknown) {
  return app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

describe("GET /health", () => {
  it("reports the analyzer mode", async () => {
    const res = await mkApp().request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, analyzer: "mock" });
  });
});

describe("POST /analyze", () => {
  it("returns a rubric-aligned result with the reversibility omission on submission 4", async () => {
    const res = await post(mkApp(), "/analyze", { assignmentId: assignment.id, submission: sub(4) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnalysisResult;
    expect(body.submissionId).toBe("sub-04");
    expect(body.criteria).toHaveLength(6);
    const rev = body.criteria.find((c) => c.criterionId === "reversibility")!;
    expect(rev.missingConcepts).toContain("reversibility");
    expect(body.feedbackDraft).toMatch(/^Daniel,/);
  });

  it("rejects malformed bodies", async () => {
    const res = await post(mkApp(), "/analyze", { nope: true });
    expect(res.status).toBe(400);
  });

  it("rejects unknown assignments", async () => {
    const res = await post(mkApp(), "/analyze", { assignmentId: "other", submission: sub(1) });
    expect(res.status).toBe(404);
  });
});

describe("decision flow", () => {
  it("raises the demo alert on submission 11 after submission 4, and override silences it", async () => {
    const app = mkApp();
    let res = await post(app, "/decision", { decision: decision(4, 2.5, ["reversibility", "dynamic_equilibrium"]) });
    expect((await res.json()).alert).toBeNull();

    res = await post(app, "/decision", { decision: decision(11, 0, ["reversibility", "dynamic_equilibrium"]) });
    const { alert } = await res.json();
    expect(alert).toMatchObject({
      priorSubmissionIndex: 4,
      currentSubmissionIndex: 11,
      sharedConcept: "reversibility",
      priorDeduction: 2.5,
      currentDeduction: 5,
      spread: 2.5,
    });

    res = await post(app, "/override", { assignmentId: assignment.id, decisionIdA: "d11", decisionIdB: "d4" });
    expect(res.status).toBe(204);

    res = await post(app, "/decision", { decision: decision(11, 0, ["reversibility"], "d11") });
    expect((await res.json()).alert).toBeNull();

    res = await app.request(`/session/${assignment.id}`);
    const session = await res.json();
    expect(session.decisions).toHaveLength(3);
    expect(session.alertsRaised).toBe(1);
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
