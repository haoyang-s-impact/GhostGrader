# Ghost Grader

## Keep this file current

**Any change to the system's architecture, data model, package layout, API
routes, environment variables, or invariants must update this file in the same
change.** If a change makes a statement here false, fix the statement; do not
leave it stale. Treat CLAUDE.md as part of the change, not documentation to
write later. The same goes for `README.md` when the change affects setup, the
demo, or anything a user reads.

## What the system is

A grading copilot that works **inside the LMS page the teacher already
grades in**, with a small API and web app behind it.

1. **Chrome extension (`apps/extension`)**: on Moodle's quiz manual-grading
   page (`mod/quiz/report.php?mode=grading`) a panel opens beside the marks.
   The content script reads the question, its "Information for graders", and
   every attempt on the page, and posts them to the API (`POST /lms/moodle/page`).
   First sight of a question drafts a rubric from the grader notes. Each
   attempt gets a rubric-referenced mark with reasoning; **Use** writes the
   mark into Moodle's mark box and the feedback into its TinyMCE comment.
   Typing a mark drives the rubric check. Clicking Moodle's **Save and show
   next** is intercepted once: every mark becomes a Decision, the API compares
   each with the other students on that question, and the save is held while
   consistency alerts are open. The second click saves through Moodle.
2. **Web app (`apps/web`)**: rubric editor (including rubrics the extension
   drafted), a standalone grading workspace for the seeded demo, and the
   gradebook.
3. **API (`apps/api`)**: rubrics, answers, decisions and sessions in SQLite;
   the LLM provider chain; drift detection; the LMS sync layer.

Ghost Grader never grades on its own. A suggestion only becomes a grade when
the teacher clicks Use or types a mark and saves, and nothing reaches Moodle
except through Moodle's own form.

Ghost Grader never grades on its own. A suggestion only becomes a grade when
the teacher clicks Submit, and nothing is written to an LMS until the teacher
pushes.

`docs/plans/` holds the original design and implementation plan. They describe
the earlier Chrome-extension version and are kept as history, not as the
current design.

## Repo map

pnpm workspace (`apps/*`, `packages/*`), TypeScript everywhere.

| Package | Path | Owns |
|---|---|---|
| `@gg/shared` | `packages/shared` | Zod schemas and types, rubric math and rollup (`rubric.ts`), drift detection (`drift.ts`), push diffing (`sync.ts`), the deterministic mock analyzer, and the seeded dataset (`data.ts`, `fixtures/`). |
| `@gg/api` | `apps/api` | Hono server on port 8787. SQLite store through Drizzle (`store.ts`, schema in `db/schema.ts`, migrations in `drizzle/`), teacher scoping, LLM provider chain, grading sessions, and LMS sync behind the `LmsAdapter` interface. |
| `@gg/web` | `apps/web` | React + Vite app on port 5173: courses, grading workspace, gradebook, rubric editor. Playwright e2e for the web app lives here. |
| `@gg/extension` | `apps/extension` | Manifest V3 Chrome extension for Moodle. `src/content/moodle.ts` is the only file that knows Moodle's DOM; `Panel.tsx` owns the flow; `page-bridge-core.ts` runs in the page world to drive TinyMCE. Built by `build.mjs` (one bundle per entry). Playwright e2e runs against the local Moodle. |

### Data model (`packages/shared/src/schemas.ts`)

- **Assignment** → ordered **Questions** (embedded). A question carries its own
  `rubric` (criteria, point bands, closed `concepts` vocabulary), `anchors`,
  optional `totalPoints`, and `lmsQuestionId`.
- **Student**, and **Answer** keyed by `(questionId, studentId)`, with
  `studentIndex` (roster position) and `lmsAnswerId`.
- **Decision**: one submitted grade for one answer, id `${answerId}:grade`, with
  the suggestion at the time, missing concepts, and the teacher's comment.
- **AnalysisResult** / **ScoreCheck** / **DriftAlert**: all per question.
- **PushRecord**: what was sent to an LMS, kept separate from Decision so a
  re-grade cannot erase the fact that a grade was already pushed.
- Assignment grades are **computed** by `rollUp` (`rubric.ts`), never stored.

Seed: `chem-haber-eq` has Q1 (`q-haber-1`, 6 criteria, 30 pts, 15 answers
`sub-01`..`sub-15` with ground truth) and Q2 (`q-haber-2`, 3 criteria, 15 pts, 5
answers `q2-sub-*`, no ground truth, so it exercises the heuristic analyzer).
Q1 answer ids must stay `sub-01`..`sub-15`: `ground-truth.json` and
`fixtures/analysis/*.json` are keyed by them. Q1 and Q2 deliberately share the
tag `quantitative_reference` to prove per-question scoping.

### API routes (`apps/api/src/app.ts`)

Public: `GET /health` (analyzer mode, `lms` name or null), `GET /teachers`.
Everything else requires `X-Teacher-Id`.

- Data: `GET /me`, `GET|POST /courses`, `GET|POST /assignments`,
  `GET|PUT /assignments/:id`, `GET|POST /assignments/:id/answers`
  (`?questionId=`), `GET /assignments/:id/grades` (rollup).
- Grading: `POST /analyze {assignmentId, questionId, answerId}` (the answer is
  loaded server-side), `POST /decision`, `POST /override`, `POST /aligned`,
  `POST /check-raised`, `POST /check-approved`, `GET|DELETE /session/:assignmentId`.
- Sync: `GET /sync/available`, `POST /sync/pull`, `GET /sync/status/:assignmentId`,
  `POST /sync/push`. With no LMS configured they return 400 "No LMS is
  configured" (status returns `{ linked: false, lms: null }`).
- Extension: `POST /lms/moodle/page` (`src/lms/page-sync.ts`). Body: course,
  quiz, question (with `graderInfo`) and the attempts on the page. Upserts
  course/assignment/question/students/answers keyed by namespaced LMS ids
  (`moodle:quiz:157`, `moodle:q:172`, `moodle:quba:78:1`, `moodle:user:<email>`),
  drafts the rubric via `src/rubric-draft.ts` on first sight (model through
  `selectJsonChat`, else the `Score N:` parser), and returns
  `{ assignmentId, questionId, rubricDrafted, answers: { [attemptLmsId]: { answerId, studentId, studentIndex } } }`.
  Rubrics the teacher edited afterwards are never overwritten.

### Extension (`apps/extension/src`)

- `content/index.tsx` mounts only on `mode=grading` pages with at least one
  attempt. `content/moodle.ts` parses the page (ids from the options form's
  hidden inputs, course from the breadcrumb link, attempts by walking
  `#manualgradingform` so each `.que` pairs with the `h4` above it) and writes
  marks with real input events.
- `content/bridge.ts` + `page-bridge-core.ts`: TinyMCE is only reachable from
  the page world, so comments are set through `postMessage` to an injected
  bridge; the textarea is written as a fallback.
- Settings (`settings.ts`): `apiBase`, `webBase`, `teacherId` in
  `chrome.storage.sync`, editable on the options page. **Embed mode:** if
  `window.__ggSettings` exists the bundle runs without `chrome.*`, so
  `dist/content.js` can be loaded as a plain script for demos.
- Decision ids are `${answerId}:grade`, the same convention as the web app.

### Web app (`apps/web/src`)

Hash routes: `#/` home, `#/grade/:assignmentId/:questionId[/:answerId]`,
`#/grades/:assignmentId`, `#/rubric/:assignmentId`, `#/rubric/new/:courseId`.
Grading logic is the `useGrading` hook (`grading/useGrading.ts`); the page owns
the grade and comment as form state. Panel tabs are in `grading/tabs/`.

## Database (`apps/api`)

One SQLite file holds everything. Drizzle ORM (`drizzle-orm/better-sqlite3`)
is the query layer; `better-sqlite3` is the driver (synchronous, so store
methods return plain values, no `await`).

### Lifecycle

1. `openDb(path)` (`src/db/index.ts`) creates the directory if needed, opens
   the file, sets `journal_mode = WAL` and `foreign_keys = ON`, and runs every
   migration in `apps/api/drizzle/` that the `__drizzle_migrations` table has
   not recorded yet. A file that is not SQLite makes it throw with a clear
   message instead of failing later.
2. `new Store(path, seed, log)` (`src/store.ts`) calls `openDb`, then, if the
   `teachers` table is empty, inserts `seedData()` from `json-store.ts` in one
   transaction (two teachers, two courses, the chemistry assignment with both
   questions, the fifteen plus five seeded answers). An existing database is
   never reseeded.
3. `index.ts` builds the store once with `GG_DB_PATH` (default
   `apps/api/data/ghost-grader.sqlite`) and hands it to `createApp`. Tests use
   `new Store()` for an in-memory database; call `store.close()` when a test
   opens a file-backed one.

The WAL mode leaves `.sqlite-wal` and `.sqlite-shm` beside the file while the
API is running. All three are gitignored; deleting the `.sqlite` file resets
the demo.

### Tables (`src/db/schema.ts`)

| Table | Keyed by | Holds |
|---|---|---|
| `teachers` | id | name, email |
| `courses` | id | teacher_id, name, term, lms_course_id |
| `students` | id | name, lms_student_id |
| `assignments` | id | teacher_id, course_id, title, course, `learning_objectives` JSON, `questions` JSON (every question with its rubric, anchors, totalPoints, lmsQuestionId), updated_at, lms_assignment_id, last_pulled_at |
| `answers` | id | assignment_id, question_id, student_id, student_name, student_index, text, lms_answer_id, submitted_at, pulled_at |
| `decisions` | id (`${answerId}:grade`) | assignment_id, question_id, answer_id, student_id, points, max_points, suggested_points (nullable), `missing_concepts` JSON, comment, at |
| `overrides` | (assignment_id, key) unique | "Keep mine" pairs, `key` from `overrideKey` |
| `session_stats` | assignment_id | alerts_raised, alerts_aligned, checks_raised, checks_approved, `checks_raised_for` JSON |
| `pushes` | seq autoincrement | assignment_id plus every `PushRecord` field; several rows per answer, the latest wins |

Column names are snake_case in SQL and camelCase in TypeScript; Drizzle maps
them. Indexes exist on every foreign key and on `(assignment_id, question_id)`
for answers and decisions. Rubrics are not normalized on purpose: a question's
rubric is always read and written whole, and `finalizeAnalysis` needs the whole
thing anyway.

### How the store maps the domain

- `Store` is the only module that imports Drizzle. Its methods mirror the JSON
  store it replaced one for one, returning the same shared types.
- **Sessions** are not a table. `session(assignmentId)` assembles a
  `SessionState` from `decisions`, `overrides` and `session_stats`;
  `saveSession` writes all three in one transaction: decisions upserted by id
  and stale rows pruned, overrides deleted and reinserted, stats upserted.
  `SessionService` mutates the in-memory `SessionState` and calls `saveSession`,
  exactly as it did with the JSON file. `resetSession` deletes the three tables'
  rows for that assignment and leaves `pushes` alone.
- **Pushes** are replaced wholesale per assignment by `savePushes`, matching how
  `SyncService` rebuilds the list from `latestPushes`.
- `upsertStudent` / `upsertAnswer` are `INSERT ... ON CONFLICT(id) DO UPDATE`.
- LMS-id lookups (`courseByLmsId`, `assignmentByLmsId`, `studentByLmsId`,
  `answerByLmsId`) return nothing for an empty id, so locally created rows
  never match a pull.
- `newId(prefix)` makes ids; nothing relies on autoincrement except `pushes.seq`.

### Changing the schema

1. Edit `src/db/schema.ts` (and the Zod schema in `@gg/shared` if the domain
   type changes).
2. Run `pnpm --filter @gg/api db:generate`. It writes a new SQL file and
   updates `drizzle/meta/`. Commit both.
3. Adjust `Store` so the domain type still round-trips (see
   `toAssignmentRow` / `fromAssignmentRow` for the JSON-column pattern).
4. Add or update a test in `test/store.test.ts`.

Never edit a migration that is already committed; add a new one. Every
developer's database applies pending migrations on the next API start.

### Inspecting and resetting

```bash
sqlite3 apps/api/data/ghost-grader.sqlite '.tables'
sqlite3 apps/api/data/ghost-grader.sqlite 'select id, points, suggested_points from decisions;'
rm apps/api/data/ghost-grader.sqlite*      # start over; the next API start reseeds
pnpm --filter @gg/api import-json [file]   # copy a pre-SQLite data/ghost-grader.json in (JsonStore is kept only for this)
```

## Invariants: do not break these

- **Points come from the rubric, never from the model.** `finalizeAnalysis`
  (`packages/shared/src/rubric.ts`) maps the chosen band to points.
- **Missing concepts are filtered to the criterion's closed `concepts`
  vocabulary.** That is what keeps checks explainable.
- **Comparison is per question and deterministic.** `detectDrift`
  (`packages/shared/src/drift.ts`) only compares decisions with the same
  `questionId`, from other students, by offset from the suggestion. No model call.
- **Typing is a draft; only Submit records a Decision.** Grades applied by
  Use/Align/Approve are drafts too and must not be overwritten by a session
  refresh (`views/Grade.tsx` tracks this with `touched`). In the extension the
  equivalent of Submit is Moodle's Save button: decisions are recorded in the
  intercepted submit, never while typing.
- **The extension never bypasses Moodle's form.** It fills inputs and lets
  Moodle save; the only thing it adds to a save is a one-time hold while
  consistency alerts are open (`bypassSubmit` in `Panel.tsx`).
- **Pushing to an LMS is always an explicit teacher action**, and idempotent:
  `pushReference(answerId, points, comment)` is the upsert key, and
  `pendingPush` compares against the **latest** push per answer.
- **Teacher scoping:** a foreign resource returns 404, never 403.
- **Store schema lives in `apps/api/src/db/schema.ts` and changes only with a
  migration.** After editing the schema run `pnpm --filter @gg/api db:generate`
  and commit the new file under `apps/api/drizzle/`. Migrations are applied at
  API startup (`openDb`), so pulling and starting is enough. Never edit an
  existing migration. Documents read and written whole (questions with their
  rubrics, learning objectives, missing-concept lists) are JSON columns.
- **`Store` keeps its public surface** (`teachers`, `coursesFor`, `answersFor`,
  `session`/`saveSession`/`resetSession`, `pushesFor`/`savePushes`, ...).
  Routes, `SessionService` and `SyncService` never touch Drizzle directly.
  `new Store()` with no path is an in-memory database for tests; an empty
  database is seeded with the demo data on first open.
- **`@gg/shared` is consumed as TypeScript source.** It has no build step;
  consumers include `../../packages/shared/src` in their tsconfig.
- **Adding an LMS** means implementing `LmsAdapter` (`apps/api/src/lms/`) and
  selecting it in `lms/select.ts`. Nothing else should know which LMS it is.
  The LMS never owns rubrics.

## Commands

```bash
pnpm install
pnpm dev          # API on 8787 and web app on 5173
pnpm build
pnpm typecheck
pnpm test         # vitest in every package
pnpm --filter @gg/api db:generate   # after changing apps/api/src/db/schema.ts
pnpm --filter @gg/api import-json   # one-time import of an old data/ghost-grader.json
pnpm --filter @gg/api compare-models <assignmentId> <questionId> --models=a,b --expected=f.json   # model bake-off on a synced question
pnpm e2e          # Playwright against the web app; boots API (mock analyzer) and web itself
pnpm --filter @gg/extension build   # dist/ to load unpacked in Chrome
pnpm --filter @gg/extension e2e     # Playwright against the local Moodle (MOODLE_URL, MOODLE_USER, MOODLE_PASSWORD, MOODLE_GRADING_URL)
```

`pnpm e2e` uses ports 8787/5173 by default. If dev servers already hold them,
run with `E2E_API_PORT=18787 E2E_WEB_PORT=15173`. First run needs
`pnpm --filter @gg/web e2e:install`.

On a machine without a global `pnpm`, run it through `corepack pnpm`; the root
scripts shell out to bare `pnpm`, so a shim on PATH is needed.

## Environment (`apps/api/.env`, see `.env.example`)

- LLM provider chain, first configured is primary, the rest are fallbacks:
  `OPENROUTER_API_KEY` (+`OPENROUTER_MODEL`) → `OPENAI_API_KEY` (+`OPENAI_MODEL`)
  → `ANTHROPIC_API_KEY`. No key: deterministic mock analyzer. `GG_MOCK=1`
  forces the mock (tests do this).
- `PORT` (8787), `GG_DB_PATH` (default `apps/api/data/ghost-grader.sqlite`, gitignored).
- `GG_LMS` (unset: no LMS; `canvas`: stub, not implemented), `GG_LMS_BASE_URL`, `GG_LMS_TOKEN`.
- Web: `VITE_API_BASE` (default `http://localhost:8787`).
