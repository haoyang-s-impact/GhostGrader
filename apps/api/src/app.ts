import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { assignment as seededAssignment, criterionById, DecisionSchema, SubmissionSchema } from "@gg/shared";
import type { AnalyzerInfo } from "./analyzer";
import { AnalysisError } from "./claude";
import { SessionStore } from "./session";

const AnalyzeBody = z.object({ assignmentId: z.string(), submission: SubmissionSchema });
const DecisionBody = z.object({ decision: DecisionSchema });
const OverrideBody = z.object({ assignmentId: z.string(), decisionIdA: z.string(), decisionIdB: z.string() });
const AlignedBody = z.object({ assignmentId: z.string() });

export interface AppDeps {
  analyzer: AnalyzerInfo;
  store?: SessionStore;
}

export function createApp({ analyzer, store = new SessionStore() }: AppDeps) {
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: (origin) => {
        if (!origin) return "*";
        if (origin.startsWith("chrome-extension://")) return origin;
        if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
        return "";
      },
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type"],
    }),
  );

  app.get("/health", (c) => c.json({ ok: true, analyzer: analyzer.mode }));

  app.get("/assignment", (c) => c.json(seededAssignment));

  app.post("/analyze", async (c) => {
    const parsed = AnalyzeBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
    const { assignmentId, submission } = parsed.data;
    if (assignmentId !== seededAssignment.id) return c.json({ error: "Unknown assignment" }, 404);
    try {
      const result = await analyzer.analyze(submission, seededAssignment);
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Analysis failed";
      const retryable = err instanceof AnalysisError ? err.retryable : true;
      return c.json({ error: message, retryable }, 502);
    }
  });

  app.post("/decision", async (c) => {
    const parsed = DecisionBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
    const { decision } = parsed.data;
    let criterion;
    try {
      criterion = criterionById(decision.criterionId);
    } catch {
      return c.json({ error: "Unknown criterion" }, 404);
    }
    const alert = store.record(decision, criterion);
    return c.json({ alert });
  });

  app.post("/override", async (c) => {
    const parsed = OverrideBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid body" }, 400);
    store.override(parsed.data.assignmentId, parsed.data.decisionIdA, parsed.data.decisionIdB);
    return c.body(null, 204);
  });

  app.post("/aligned", async (c) => {
    const parsed = AlignedBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid body" }, 400);
    store.markAligned(parsed.data.assignmentId);
    return c.body(null, 204);
  });

  app.get("/session/:assignmentId", (c) => {
    const s = store.get(c.req.param("assignmentId"));
    return c.json({
      decisions: s.decisions,
      alertsRaised: s.alertsRaised,
      alertsAligned: s.alertsAligned,
    });
  });

  app.delete("/session/:assignmentId", (c) => {
    store.reset(c.req.param("assignmentId"));
    return c.body(null, 204);
  });

  return app;
}
