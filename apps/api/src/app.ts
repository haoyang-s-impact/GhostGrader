import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { AssignmentInputSchema, DecisionSchema, SubmissionSchema, type Assignment } from "@gg/shared";
import type { AnalyzerInfo } from "./analyzer";
import { AnalysisError } from "./claude";
import { SessionService } from "./session";
import { newId, Store } from "./store";

const AnalyzeBody = z.object({ assignmentId: z.string(), submission: SubmissionSchema });
const DecisionBody = z.object({ decision: DecisionSchema });
const OverrideBody = z.object({ assignmentId: z.string(), decisionIdA: z.string(), decisionIdB: z.string() });
const AssignmentIdBody = z.object({ assignmentId: z.string() });
const CourseBody = z.object({ name: z.string().min(1), term: z.string().default("") });
const SubmissionBody = z.object({ studentName: z.string().min(1), text: z.string().min(1) });

export const TEACHER_HEADER = "x-teacher-id";

export interface AppDeps {
  analyzer: AnalyzerInfo;
  store?: Store;
}

type Env = { Variables: { teacherId: string } };

export function createApp({ analyzer, store = new Store() }: AppDeps) {
  const sessions = new SessionService(store);
  const app = new Hono<Env>();

  app.use(
    "*",
    cors({
      origin: (origin) => {
        if (!origin) return "*";
        if (origin.startsWith("chrome-extension://")) return origin;
        if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
        return "";
      },
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "X-Teacher-Id"],
    }),
  );

  app.get("/health", (c) => c.json({ ok: true, analyzer: analyzer.mode, model: analyzer.model }));
  app.get("/lms/teachers", (c) => c.json(store.teachers()));

  // Every other route is scoped to one teacher. A real deployment would put
  // an LTI launch or OAuth session here; the demo uses a header.
  app.use("*", async (c, next) => {
    if (c.req.path === "/health" || c.req.path === "/lms/teachers") return next();
    const id = c.req.header(TEACHER_HEADER);
    if (!id || !store.teacher(id)) return c.json({ error: "Missing or unknown X-Teacher-Id" }, 401);
    c.set("teacherId", id);
    await next();
  });

  const requireAssignment = (c: { get: (k: "teacherId") => string }, id: string): Assignment | undefined =>
    store.assignment(c.get("teacherId"), id);

  // ----- LMS data (mock Canvas backend) -----
  app.get("/lms/me", (c) => c.json(store.teacher(c.get("teacherId"))));

  app.get("/lms/courses", (c) => c.json(store.coursesFor(c.get("teacherId"))));

  app.post("/lms/courses", async (c) => {
    const parsed = CourseBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
    return c.json(store.createCourse(c.get("teacherId"), parsed.data.name, parsed.data.term), 201);
  });

  app.get("/lms/assignments", (c) => c.json(store.assignmentsFor(c.get("teacherId"), c.req.query("courseId") || undefined)));

  app.post("/lms/assignments", async (c) => {
    const parsed = AssignmentInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid assignment", issues: parsed.error.issues }, 400);
    const course = store.course(c.get("teacherId"), parsed.data.courseId);
    if (!course) return c.json({ error: "Unknown course" }, 404);
    const issue = validateRubric(parsed.data);
    if (issue) return c.json({ error: issue }, 400);
    const a: Assignment = { ...parsed.data, id: newId("a"), teacherId: c.get("teacherId"), course: course.name, updatedAt: Date.now() };
    return c.json(store.createAssignment(a), 201);
  });

  app.get("/lms/assignments/:id", (c) => {
    const a = requireAssignment(c, c.req.param("id"));
    return a ? c.json(a) : c.json({ error: "Not found" }, 404);
  });

  app.put("/lms/assignments/:id", async (c) => {
    const existing = requireAssignment(c, c.req.param("id"));
    if (!existing) return c.json({ error: "Not found" }, 404);
    const parsed = AssignmentInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid assignment", issues: parsed.error.issues }, 400);
    const course = store.course(c.get("teacherId"), parsed.data.courseId);
    if (!course) return c.json({ error: "Unknown course" }, 404);
    const issue = validateRubric(parsed.data);
    if (issue) return c.json({ error: issue }, 400);
    const updated = store.updateAssignment(c.get("teacherId"), existing.id, { ...parsed.data, course: course.name, updatedAt: Date.now() });
    return c.json(updated);
  });

  app.get("/lms/assignments/:id/submissions", (c) => {
    const a = requireAssignment(c, c.req.param("id"));
    return a ? c.json(store.submissionsFor(a.id)) : c.json({ error: "Not found" }, 404);
  });

  app.post("/lms/assignments/:id/submissions", async (c) => {
    const a = requireAssignment(c, c.req.param("id"));
    if (!a) return c.json({ error: "Not found" }, 404);
    const parsed = SubmissionBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid body" }, 400);
    return c.json(store.addSubmission(a.id, parsed.data.studentName, parsed.data.text), 201);
  });

  // ----- Ghost Grader -----
  app.post("/analyze", async (c) => {
    const parsed = AnalyzeBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
    const assignment = requireAssignment(c, parsed.data.assignmentId);
    if (!assignment) return c.json({ error: "Unknown assignment" }, 404);
    try {
      return c.json(await analyzer.analyze(parsed.data.submission, assignment));
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
    const assignment = requireAssignment(c, decision.assignmentId);
    if (!assignment) return c.json({ error: "Unknown assignment" }, 404);
    return c.json({ alert: sessions.record(decision) });
  });

  app.post("/override", async (c) => {
    const parsed = OverrideBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid body" }, 400);
    if (!requireAssignment(c, parsed.data.assignmentId)) return c.json({ error: "Unknown assignment" }, 404);
    sessions.override(parsed.data.assignmentId, parsed.data.decisionIdA, parsed.data.decisionIdB);
    return c.body(null, 204);
  });

  for (const [path, field] of [
    ["/aligned", "alertsAligned"],
    ["/check-raised", "checksRaised"],
    ["/check-approved", "checksApproved"],
  ] as const) {
    app.post(path, async (c) => {
      const parsed = AssignmentIdBody.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json({ error: "Invalid body" }, 400);
      if (!requireAssignment(c, parsed.data.assignmentId)) return c.json({ error: "Unknown assignment" }, 404);
      sessions.bump(parsed.data.assignmentId, field);
      return c.body(null, 204);
    });
  }

  app.get("/session/:assignmentId", (c) => {
    if (!requireAssignment(c, c.req.param("assignmentId"))) return c.json({ error: "Unknown assignment" }, 404);
    const { overrides: _o, ...rest } = sessions.get(c.req.param("assignmentId"));
    return c.json(rest);
  });

  app.delete("/session/:assignmentId", (c) => {
    if (!requireAssignment(c, c.req.param("assignmentId"))) return c.json({ error: "Unknown assignment" }, 404);
    sessions.reset(c.req.param("assignmentId"));
    return c.body(null, 204);
  });

  return app;
}

/** Rubric sanity beyond the schema: at least one criterion, bands sorted and within range, unique ids. */
function validateRubric(a: z.infer<typeof AssignmentInputSchema>): string | null {
  if (a.rubric.criteria.length === 0) return "A rubric needs at least one criterion.";
  if (a.totalPoints !== undefined && a.totalPoints <= 0) return "Total points must be positive.";
  const ids = new Set<string>();
  for (const c of a.rubric.criteria) {
    if (ids.has(c.id)) return `Duplicate criterion id "${c.id}".`;
    ids.add(c.id);
    if (c.bands.length < 2) return `Criterion "${c.title}" needs at least two bands.`;
    if (c.bands.some((b) => b.points < 0 || b.points > c.maxPoints)) return `Criterion "${c.title}" has a band outside 0..${c.maxPoints}.`;
    if (!c.bands.some((b) => b.points === c.maxPoints)) return `Criterion "${c.title}" needs a band worth the full ${c.maxPoints} points.`;
  }
  return null;
}
