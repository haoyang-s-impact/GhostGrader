import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { LmsStore } from "./store";

const GradesBody = z.object({
  grades: z.array(
    z.object({
      question_id: z.string(),
      user_id: z.string(),
      score: z.number(),
      comment: z.string().optional(),
      client_reference_id: z.string().min(1),
    }),
  ),
});

/**
 * REST API of the mock LMS. Shaped like a small slice of Canvas so the Ghost
 * Grader adapter has real translation to do. No auth: it is a local stand-in.
 */
export function createLmsApp({ store = new LmsStore() }: { store?: LmsStore } = {}) {
  const app = new Hono().basePath("/api/v1");

  app.use(
    "*",
    cors({
      origin: (origin) => (!origin ? "*" : /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : ""),
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
    }),
  );

  app.get("/health", (c) => c.json({ ok: true, system: "mock-lms" }));

  app.get("/courses", (c) => c.json(store.courses()));
  app.get("/courses/:id", (c) => {
    const course = store.course(c.req.param("id"));
    return course ? c.json(course) : c.json({ error: "No such course" }, 404);
  });
  app.get("/courses/:id/assignments", (c) => c.json(store.assignments(c.req.param("id"))));

  app.get("/assignments", (c) => c.json(store.assignments()));
  app.get("/assignments/:id", (c) => {
    const a = store.assignment(c.req.param("id"));
    return a ? c.json(a) : c.json({ error: "No such assignment" }, 404);
  });

  app.get("/users", (c) => c.json(store.users()));

  app.get("/assignments/:id/submissions", (c) => {
    const a = store.assignment(c.req.param("id"));
    return a ? c.json(store.submissions(a.id)) : c.json({ error: "No such assignment" }, 404);
  });

  app.get("/assignments/:id/grades", (c) => {
    const a = store.assignment(c.req.param("id"));
    return a ? c.json(store.grades(a.id)) : c.json({ error: "No such assignment" }, 404);
  });

  /** Bulk grade upsert. Idempotent per client_reference_id. */
  app.post("/assignments/:id/grades", async (c) => {
    const a = store.assignment(c.req.param("id"));
    if (!a) return c.json({ error: "No such assignment" }, 404);
    const parsed = GradesBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
    return c.json(store.upsertGrades(a.id, parsed.data.grades));
  });

  /** Empty the gradebook for an assignment, to rerun a demo. */
  app.delete("/assignments/:id/grades", (c) => {
    const a = store.assignment(c.req.param("id"));
    if (!a) return c.json({ error: "No such assignment" }, 404);
    store.clearGrades(a.id);
    return c.body(null, 204);
  });

  return app;
}
