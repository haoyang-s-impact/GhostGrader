# SQLite Database for Ghost Grader

Date: 2026-09-12
Status: validated with the team, being implemented on `feature/agent-grading`

## Goal

Replace the JSON-file store with SQLite through Drizzle ORM, and move the
teacher's grade record (draft, comment, submitted grade) from browser
localStorage to the server, so two people working on the project and any
browser see the same data.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Database | SQLite, single file | Zero infrastructure, works offline at the demo. |
| Driver and ORM | better-sqlite3 + Drizzle | Prebuilt binaries for Node 20, synchronous driver, typed schema and migrations. A later move to Postgres or Turso is small. |
| Rubric storage | JSON column on `assignments` | Read and written whole; normalizing criteria and bands buys nothing at this size. |
| Migrations | drizzle-kit generate, applied at API startup | Pulling the branch and starting the API is enough; no manual step. |
| Tests | In-memory SQLite with migrations applied | Fast, isolated, exercises the real store. |
| Grades | New `grades` table with draft and submitted state | Removes the last client-only state; the LMS stores the grade, Ghost Grader stores the decision. |

## Schema

- `teachers(id, name, email)`
- `courses(id, teacher_id, name, term)`
- `assignments(id, teacher_id, course_id, title, course, prompt, learning_objectives JSON, rubric JSON, anchors JSON, total_points, updated_at)`
- `submissions(id, assignment_id, idx, student_name, text)`
- `decisions(id, assignment_id, submission_id, submission_index, student_name, points, max_points, suggested_points, missing_concepts JSON, at)` — one row per submission, upserted on Submit
- `overrides(assignment_id, key)` — unique pair
- `session_stats(assignment_id, alerts_raised, alerts_aligned, checks_raised, checks_approved, checks_raised_for JSON)`
- `grades(assignment_id, submission_id, draft_points, comment, submitted_points, submitted_at)` — primary key (assignment_id, submission_id)

Indexes on every foreign key and on `decisions(assignment_id)`. Teacher
scoping stays as it is: every query filters by teacher through the assignment.

## Store and routes

`Store` keeps its public method signatures; each method becomes a Drizzle
query. Recording a decision upserts the row and bumps stats in one
transaction. `resetSession` deletes decisions, overrides, and stats for the
assignment together.

New teacher-scoped routes:

- `GET /lms/assignments/:id/grades` — every grade record, keyed by submission
- `PUT /lms/assignments/:id/grades/:submissionId` `{ draftPoints, comment }` — save the draft, debounced client-side
- `POST /lms/assignments/:id/grades/:submissionId/submit` `{ points, comment }` — commit, stamp `submitted_at`, return the record

Decision recording stays on `/decision`, driven by the extension.

## Mock LMS

`speedgrader.ts` loads grades from the API, writes drafts through the PUT
route, calls the submit route from the Submit button before publishing the
`data-gg-submitted-*` attributes, and reads the graded counter from the
server. A one-time migration pushes any grades still in localStorage to the
API and clears them.

## Seeding and import

Empty database on first start: seed the two teachers, two courses, the
chemistry assignment, and fifteen essays. `pnpm --filter @gg/api import-json`
imports an existing `ghost-grader.json` once.

## Testing

- API tests run against `new Store(":memory:")` unchanged.
- New store tests: file round trip, decision upsert, grade draft then submit, teacher isolation on grade routes, JSON import.
- Playwright: temp SQLite path; new test that a draft survives a reload and a submit survives a reload.

## Rollout

1. Schema, migrations, new `Store`; old JSON store kept for import only.
2. Grade routes and API tests.
3. Mock LMS on the grade routes, localStorage migration, end-to-end tests.
4. README, `.env.example`, design refresh.
