import { Hono } from "hono";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cors } from "hono/cors";
import { z } from "zod";
import { AssignmentInputSchema, DecisionSchema, questionById, rollUp, type Assignment } from "@gg/shared";
import type { AnalyzerInfo } from "./analyzer";
import { AnalysisError } from "./claude";
import { LmsError, type LmsAdapter } from "./lms/adapter";
import { MoodlePageBody, syncGradingPage } from "./lms/page-sync";
import type { JsonChat } from "./openrouter";
import { SessionService } from "./session";
import { newId, Store } from "./store";
import { SyncError, SyncService } from "./sync";

const AnalyzeBody = z.object({ assignmentId: z.string(), questionId: z.string(), answerId: z.string() });
const DecisionBody = z.object({ decision: DecisionSchema });
const OverrideBody = z.object({ assignmentId: z.string(), decisionIdA: z.string(), decisionIdB: z.string() });
const AssignmentIdBody = z.object({ assignmentId: z.string(), answerId: z.string().optional() });
const CourseBody = z.object({ name: z.string().min(1), term: z.string().default("") });
const AnswerBody = z.object({ questionId: z.string(), studentName: z.string().min(1), text: z.string().min(1) });
const PullBody = z.object({ lmsAssignmentId: z.string().min(1) });
const PushBody = z.object({ assignmentId: z.string(), answerIds: z.array(z.string()).optional() });

export const TEACHER_HEADER = "x-teacher-id";

export interface AppDeps {
  analyzer: AnalyzerInfo;
  store?: Store;
  /** The LMS to sync with. Omitted: no LMS; the seeded answers are graded as they are. */
  lms?: LmsAdapter | null;
  /** JSON chat for auxiliary model calls (rubric drafting). Null: deterministic fallbacks. */
  chat?: JsonChat | null;
  log?: (m: string) => void;
}

type Env = { Variables: { teacherId: string } };

const PUBLIC_PATHS = new Set(["/health", "/teachers"]);

/** The built extension, served so the panel can be injected into an LMS page without installing it (demos, screen shares). */
const EXTENSION_DIST = join(dirname(fileURLToPath(import.meta.url)), "../../extension/dist");
const EMBED_FILES: Record<string, string> = { "content.js": "text/javascript; charset=utf-8" };

export function createApp({ analyzer, store = new Store(), lms = null, chat = null, log }: AppDeps) {
  const sessions = new SessionService(store);
  const sync = lms ? new SyncService(store, lms) : null;
  const noLms = (c: { json: (body: unknown, status: 400) => Response }) =>
    c.json({ error: "No LMS is configured. Set GG_LMS to connect one." }, 400);
  const app = new Hono<Env>();

  app.use(
    "*",
    cors({
      origin: (origin) => {
        if (!origin) return "*";
        if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
        return "";
      },
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "X-Teacher-Id"],
    }),
  );

  app.get("/health", (c) => c.json({ ok: true, analyzer: analyzer.mode, model: analyzer.model, fallbacks: analyzer.fallbacks, lms: lms?.name ?? null }));
  app.get("/teachers", (c) => c.json(store.teachers()));

  // Embed mode: <script src="http://localhost:8787/embed/content.js"> on a Moodle page mounts the panel.
  app.get("/embed/:file", (c) => {
    const file = c.req.param("file");
    const type = EMBED_FILES[file];
    const path = join(EXTENSION_DIST, file);
    if (!type || !existsSync(path)) return c.text("Build the extension first: pnpm --filter @gg/extension build", 404);
    return c.body(readFileSync(path), 200, { "content-type": type, "cache-control": "no-store" });
  });

  // Every other route is scoped to one teacher. A real deployment would put
  // an LTI launch or OAuth session here; the demo uses a header.
  app.use("*", async (c, next) => {
    if (PUBLIC_PATHS.has(c.req.path) || c.req.path.startsWith("/embed/")) return next();
    const id = c.req.header(TEACHER_HEADER);
    if (!id || !store.teacher(id)) return c.json({ error: "Missing or unknown X-Teacher-Id" }, 401);
    c.set("teacherId", id);
    await next();
  });

  // A foreign assignment is indistinguishable from a missing one: 404, never 403.
  const requireAssignment = (c: { get: (k: "teacherId") => string }, id: string): Assignment | undefined =>
    store.assignment(c.get("teacherId"), id);

  // ----- Ghost Grader's own data: courses, assignments, questions, rubrics, answers -----
  app.get("/me", (c) => c.json(store.teacher(c.get("teacherId"))));

  app.get("/courses", (c) => c.json(store.coursesFor(c.get("teacherId"))));

  app.post("/courses", async (c) => {
    const parsed = CourseBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
    return c.json(store.createCourse(c.get("teacherId"), parsed.data.name, parsed.data.term), 201);
  });

  app.get("/assignments", (c) => c.json(store.assignmentsFor(c.get("teacherId"), c.req.query("courseId") || undefined)));

  app.post("/assignments", async (c) => {
    const parsed = AssignmentInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid assignment", issues: parsed.error.issues }, 400);
    const course = store.course(c.get("teacherId"), parsed.data.courseId);
    if (!course) return c.json({ error: "Unknown course" }, 404);
    const issue = validateAssignment(parsed.data);
    if (issue) return c.json({ error: issue }, 400);
    const a: Assignment = {
      ...parsed.data,
      id: newId("a"),
      teacherId: c.get("teacherId"),
      course: course.name,
      updatedAt: Date.now(),
      lmsAssignmentId: "",
      lastPulledAt: 0,
    };
    return c.json(store.createAssignment(a), 201);
  });

  app.get("/assignments/:id", (c) => {
    const a = requireAssignment(c, c.req.param("id"));
    return a ? c.json(a) : c.json({ error: "Not found" }, 404);
  });

  // Edits questions and rubrics. LMS linkage is preserved: it is set by a pull, never by the editor.
  app.put("/assignments/:id", async (c) => {
    const existing = requireAssignment(c, c.req.param("id"));
    if (!existing) return c.json({ error: "Not found" }, 404);
    const parsed = AssignmentInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid assignment", issues: parsed.error.issues }, 400);
    const course = store.course(c.get("teacherId"), parsed.data.courseId);
    if (!course) return c.json({ error: "Unknown course" }, 404);
    const issue = validateAssignment(parsed.data);
    if (issue) return c.json({ error: issue }, 400);
    const questions = parsed.data.questions.map((q) => ({
      ...q,
      lmsQuestionId: existing.questions.find((e) => e.id === q.id)?.lmsQuestionId ?? "",
    }));
    const updated = store.updateAssignment(c.get("teacherId"), existing.id, {
      ...parsed.data,
      questions,
      course: course.name,
      updatedAt: Date.now(),
      lmsAssignmentId: existing.lmsAssignmentId,
      lastPulledAt: existing.lastPulledAt,
    });
    return c.json(updated);
  });

  app.get("/assignments/:id/answers", (c) => {
    const a = requireAssignment(c, c.req.param("id"));
    return a ? c.json(store.answersFor(a.id, c.req.query("questionId") || undefined)) : c.json({ error: "Not found" }, 404);
  });

  // Local answers, for assignments authored here rather than pulled from an LMS.
  app.post("/assignments/:id/answers", async (c) => {
    const a = requireAssignment(c, c.req.param("id"));
    if (!a) return c.json({ error: "Not found" }, 404);
    const parsed = AnswerBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid body" }, 400);
    if (!questionById(a, parsed.data.questionId)) return c.json({ error: "Unknown question" }, 404);
    const existing = store.answersFor(a.id);
    const match = existing.find((x) => x.studentName === parsed.data.studentName);
    const student = match ? { id: match.studentId, index: match.studentIndex } : { id: store.upsertStudent({ id: newId("stu"), name: parsed.data.studentName, lmsStudentId: "" }).id, index: Math.max(0, ...existing.map((x) => x.studentIndex)) + 1 };
    const answer = store.upsertAnswer({
      id: newId("ans"),
      assignmentId: a.id,
      questionId: parsed.data.questionId,
      studentId: student.id,
      studentName: parsed.data.studentName,
      studentIndex: student.index,
      text: parsed.data.text,
      lmsAnswerId: "",
      submittedAt: Date.now(),
      pulledAt: 0,
    });
    return c.json(answer, 201);
  });

  /** Each student's per-question grades rolled up to an assignment grade. Computed on read. */
  app.get("/assignments/:id/grades", (c) => {
    const a = requireAssignment(c, c.req.param("id"));
    if (!a) return c.json({ error: "Not found" }, 404);
    const decisions = sessions.get(a.id).decisions;
    const roster = new Map(store.answersFor(a.id).map((x) => [x.studentId, { id: x.studentId, name: x.studentName, index: x.studentIndex }]));
    return c.json([...roster.values()].sort((x, y) => x.index - y.index).map((s) => rollUp(a, s, decisions)));
  });

  // ----- Browser extension: sync a Moodle grading page into the store -----
  // The extension reads the quiz manual-grading page the teacher already has
  // open and posts it here. First sight of a question drafts its rubric from
  // the "Information for graders" text; later syncs only refresh answers.
  app.post("/lms/moodle/page", async (c) => {
    const parsed = MoodlePageBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
    try {
      return c.json(await syncGradingPage(store, c.get("teacherId"), parsed.data, chat, log));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Sync failed" }, 500);
    }
  });

  // ----- Grading -----
  app.post("/analyze", async (c) => {
    const parsed = AnalyzeBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
    const assignment = requireAssignment(c, parsed.data.assignmentId);
    if (!assignment) return c.json({ error: "Unknown assignment" }, 404);
    const question = questionById(assignment, parsed.data.questionId);
    if (!question) return c.json({ error: "Unknown question" }, 404);
    // The answer is loaded server-side rather than trusted from the client.
    const answer = store.answer(assignment.id, parsed.data.answerId);
    if (!answer || answer.questionId !== question.id) return c.json({ error: "Unknown answer" }, 404);
    try {
      return c.json(await analyzer.analyze(answer, assignment, question));
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
    const answer = store.answer(assignment.id, decision.answerId);
    if (!answer || answer.questionId !== decision.questionId || answer.studentId !== decision.studentId) {
      return c.json({ error: "Decision does not match a known answer" }, 404);
    }
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
      sessions.bump(parsed.data.assignmentId, field, parsed.data.answerId);
      return c.body(null, 204);
    });
  }

  app.get("/session/:assignmentId", (c) => {
    if (!requireAssignment(c, c.req.param("assignmentId"))) return c.json({ error: "Unknown assignment" }, 404);
    const { overrides: _o, checksRaisedFor: _c, ...rest } = sessions.get(c.req.param("assignmentId"));
    return c.json(rest);
  });

  app.delete("/session/:assignmentId", (c) => {
    if (!requireAssignment(c, c.req.param("assignmentId"))) return c.json({ error: "Unknown assignment" }, 404);
    sessions.reset(c.req.param("assignmentId"));
    return c.body(null, 204);
  });

  // ----- LMS sync: pull question/answer pairs in, push grades out -----
  app.get("/sync/available", async (c) => {
    if (!sync) return noLms(c);
    try {
      return c.json(await sync.listAvailable());
    } catch (err) {
      return lmsFailure(c, err);
    }
  });

  app.post("/sync/pull", async (c) => {
    if (!sync) return noLms(c);
    const parsed = PullBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid body" }, 400);
    try {
      return c.json(await sync.pull(c.get("teacherId"), parsed.data.lmsAssignmentId));
    } catch (err) {
      return lmsFailure(c, err);
    }
  });

  app.get("/sync/status/:assignmentId", (c) => {
    const a = requireAssignment(c, c.req.param("assignmentId"));
    if (!a) return c.json({ error: "Unknown assignment" }, 404);
    return sync ? c.json(sync.status(a)) : c.json({ linked: false, lms: null });
  });

  app.post("/sync/push", async (c) => {
    if (!sync) return noLms(c);
    const parsed = PushBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid body" }, 400);
    const a = requireAssignment(c, parsed.data.assignmentId);
    if (!a) return c.json({ error: "Unknown assignment" }, 404);
    try {
      return c.json(await sync.push(a, parsed.data.answerIds));
    } catch (err) {
      return lmsFailure(c, err);
    }
  });

  return app;
}

function lmsFailure(c: { json: (body: unknown, status: 400 | 404 | 502) => Response }, err: unknown): Response {
  if (err instanceof SyncError) return c.json({ error: err.message }, err.status);
  const message = err instanceof Error ? err.message : "LMS request failed";
  return c.json({ error: message, retryable: err instanceof LmsError ? err.retryable : true }, 502);
}

/** Structural checks beyond the schema: question ordering, and each question's rubric. */
function validateAssignment(a: z.infer<typeof AssignmentInputSchema>): string | null {
  const questionIds = new Set<string>();
  for (const [i, q] of a.questions.entries()) {
    if (questionIds.has(q.id)) return `Duplicate question id "${q.id}".`;
    questionIds.add(q.id);
    if (q.index !== i + 1) return "Questions must be numbered 1, 2, 3, ... in order.";
    const issue = validateRubric(q);
    if (issue) return `Question ${q.index}: ${issue}`;
  }
  return null;
}

/** Rubric sanity: at least one criterion, bands within range, a full-marks band, unique ids. */
function validateRubric(q: z.infer<typeof AssignmentInputSchema>["questions"][number]): string | null {
  if (q.rubric.criteria.length === 0) return "A rubric needs at least one criterion.";
  if (q.totalPoints !== undefined && q.totalPoints <= 0) return "Total points must be positive.";
  const ids = new Set<string>();
  for (const c of q.rubric.criteria) {
    if (ids.has(c.id)) return `Duplicate criterion id "${c.id}".`;
    ids.add(c.id);
    if (c.bands.length < 2) return `Criterion "${c.title}" needs at least two bands.`;
    if (c.bands.some((b) => b.points < 0 || b.points > c.maxPoints)) return `Criterion "${c.title}" has a band outside 0..${c.maxPoints}.`;
    if (!c.bands.some((b) => b.points === c.maxPoints)) return `Criterion "${c.title}" needs a band worth the full ${c.maxPoints} points.`;
  }
  return null;
}
