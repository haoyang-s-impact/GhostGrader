# Ghost Grader: Implementation Plan

Date: 2026-09-12
Design: [2026-09-12-ghost-grader-design.md](./2026-09-12-ghost-grader-design.md)

Ordered so that every phase ends with something you can run. Phases 1 to 5
produce the core demo (alignment, drift alert, feedback). Phase 6 adds the
dashboard. Phase 7 is polish and rehearsal. If time runs short, cut from the
bottom.

Environment verified on 2026-09-12: Node v20.19.2, pnpm 10.33.0, Google Chrome
installed. No `ANTHROPIC_API_KEY` in the shell and no `ant` CLI. Phase 3 covers
credentials.

## Phase 1: Monorepo scaffold

Goal: `pnpm install` and `pnpm -r build` succeed with empty apps.

Tasks:

1. Create `pnpm-workspace.yaml` listing `apps/*` and `packages/*`.
2. Root `package.json` with scripts `dev`, `build`, `test`, `typecheck` that
   fan out with `pnpm -r`.
3. Root `tsconfig.base.json` (strict, ES2022, bundler module resolution).
   Each package extends it.
4. `packages/shared`: `package.json` (name `@gg/shared`), `src/index.ts`
   exporting nothing yet, Zod as a dependency.
5. `apps/mock-lms`: `pnpm create vite` with the vanilla TypeScript template.
6. `apps/extension`: Vite plus `@crxjs/vite-plugin`, React, `manifest.json`
   with a content script matched to `http://localhost:5173/*` and
   `storage` permission.
7. `apps/api`: Hono, `@hono/node-server`, `@anthropic-ai/sdk`, `zod`, `tsx`
   for dev. `src/index.ts` serving `GET /health`.
8. `.gitignore` for `node_modules`, `dist`, `.env`.

Verify: `pnpm install`, `pnpm -r build`, `curl localhost:8787/health`.

## Phase 2: Shared schemas and seeded dataset

Goal: one source of truth for types and the demo data.

Tasks:

1. `packages/shared/src/schemas.ts`:
   - `Criterion { id, title, description, maxPoints, bands: {level, points, descriptor}[] }`
   - `Rubric { id, criteria: Criterion[] }`
   - `Assignment { id, title, prompt, learningObjectives: string[], rubric, anchors: {label, text}[] }`
   - `Submission { id, index, studentName, text }`
   - `CriterionAnalysis { criterionId, level, evidence: string[], missingConcepts: string[], confidence }`
   - `AnalysisResult { submissionId, criteria: CriterionAnalysis[], feedbackDraft }`
   - `Decision { id, assignmentId, submissionId, submissionIndex, criterionId, points, deduction, missingConcepts, at }`
   - `DriftAlert { currentDecisionId, priorDecisionId, criterionId, sharedConcept, currentDeduction, priorDeduction, spread }`
2. `packages/shared/src/drift.ts`: pure function
   `detectDrift(current: Decision, history: Decision[], overrides: Set<string>): DriftAlert | null`.
   Threshold: `max(1.5, 0.2 * criterion.maxPoints)`. Overrides are keyed by
   sorted pair of decision IDs.
3. `packages/shared/fixtures/assignment.json`: the chemistry assignment, six
   criteria, point bands, two anchor responses.
4. `packages/shared/fixtures/submissions.json`: fifteen essays. Generate with
   Claude once using a script in `packages/shared/scripts/gen-essays.ts`,
   then hand-check and freeze. Submissions 4 and 11 both omit reversibility
   and are otherwise similar in quality.
5. Vitest in `packages/shared`: `drift.test.ts` (table-driven), and
   `fixtures.test.ts` (every fixture parses through its schema).

Verify: `pnpm --filter @gg/shared test` green.

## Phase 3: Backend

Goal: `/analyze` returns a valid `AnalysisResult` for a real essay.

Tasks:

1. Credentials: create `apps/api/.env` with `ANTHROPIC_API_KEY=...` from the
   Anthropic Console. Load with `dotenv` only in dev. Never commit it.
2. `src/claude.ts`: build the system prompt from the assignment: prompt,
   objectives, rubric bands, anchors, and rules: judge only against the
   listed criteria, quote evidence verbatim, emit short snake_case concept
   tags from a provided vocabulary per criterion, keep feedback to two to
   four encouraging sentences. Mark the system block
   `cache_control: { type: "ephemeral" }`.
3. `analyze(essay, assignment)` calls `client.messages.parse` with model
   `claude-opus-5`, `max_tokens: 16000`,
   `output_config: { format: zodOutputFormat(AnalysisResultSchema) }`.
   Retry once on `parsed_output === null` or `stop_reason === "refusal"`.
   If the beta namespace exposes `parse` with `fallbacks`, enable
   `fallbacks: "default"` with beta `server-side-fallback-2026-07-01`;
   otherwise treat refusal as an analysis failure and surface it.
4. `src/session.ts`: in-memory `Map<assignmentId, { decisions: Decision[], overrides: Set<string> }>`.
5. Routes in `src/index.ts` with Zod validation on every body:
   - `POST /analyze { assignmentId, submission }` -> `AnalysisResult`
   - `POST /decision { decision }` -> `{ alert: DriftAlert | null }`
   - `POST /override { decisionIdA, decisionIdB }` -> `204`
   - `GET /session/:assignmentId` -> `{ decisions: Decision[] }`
   - CORS allowing `http://localhost:5173` and `chrome-extension://*`.
6. `scripts/analyze-all.ts`: run `/analyze` over all fifteen essays and save
   to `packages/shared/fixtures/analysis/<id>.json` for prompt regression
   checks. Log `usage.cache_read_input_tokens` to confirm caching works
   after the first call.

Verify: `curl -X POST localhost:8787/analyze` with submission 4 returns
`missingConcepts` containing `reversibility` on the reversibility criterion.
Second call shows nonzero cache reads.

## Phase 4: Mock SpeedGrader

Goal: a page that looks like Canvas and exposes stable hooks.

Tasks:

1. Layout: header bar with assignment title and submission counter, left
   essay pane, right rubric pane, comment box, prev/next buttons.
2. Load fixtures from `@gg/shared`. Keep current index in the URL hash so
   reloads land on the same submission.
3. `data-gg-*` attributes: `data-gg-submission-id`, `data-gg-submission-index`,
   `data-gg-essay`, `data-gg-criterion-id` on each row,
   `data-gg-points` on each input, `data-gg-comment` on the textarea.
4. Points inputs dispatch a native `input` event on change. Comment textarea
   accepts programmatic value set plus an `input` event.
5. Style with Canvas-like palette (white, light gray, the blue action color).
   No framework needed.

Verify: open `localhost:5173`, navigate to submission 11, reload, still on 11.

## Phase 5: Extension core

Goal: the full demo moment: alignment, score, alert, insert feedback.

Tasks:

1. `src/content/selectors.ts`: all DOM lookups in one file, returning typed
   results or `null`.
2. `src/content/observer.ts`: `MutationObserver` on the page root. Emits
   `submissionChanged(id, index, text, rubric)` and
   `pointsChanged(criterionId, points)`. Debounce points changes by 400 ms.
3. `src/content/panel.tsx`: mount a React root in an injected
   `<aside data-gg-panel>` fixed to the right edge. Tabs: Alignment,
   Consistency, Session.
4. `src/content/api.ts`: fetch wrappers for the four routes, with timeout
   and typed errors.
5. Alignment tab: on `submissionChanged`, call `/analyze`, show loading,
   then one card per criterion with level badge, evidence quotes, missing
   concept chips. Below: feedback draft with "Insert into comment" button,
   which sets the textarea and fires `input`. Retry button on failure.
6. Consistency tab: on `pointsChanged`, build a `Decision` using the
   current analysis's `missingConcepts` for that criterion, post to
   `/decision`. If an alert returns, show the card with both submission
   indices, both deductions, the shared concept, and two buttons:
   "Align to earlier" (set the points input to match and fire `input`) and
   "Keep mine" (post `/override`). Also switch the tab to Consistency and
   show a badge.
7. Persistence: mirror each decision to `chrome.storage.session`. On
   content script load, replay decisions to `/decision` if the session is
   empty on the backend.
8. Load unpacked in Chrome from `apps/extension/dist` during dev with CRXJS
   HMR.

Verify: run the demo script from the design doc end to end. Alert fires on
submission 11 referencing submission 4.

## Phase 6: Session dashboard

Goal: visible drift curve.

Tasks:

1. Session tab fetches `/session/:id` on open and after every decision.
2. Line chart: x is submission index, y is deduction, one line per
   criterion, with a dashed running mean. Use a small SVG chart built by
   hand or `recharts`; keep the bundle small.
3. Summary row: decisions recorded, alerts raised, alerts aligned.

Verify: after grading six submissions the chart shows six points per scored
criterion.

## Phase 7: Hardening and rehearsal

Tasks:

1. Playwright smoke test: load mock page with the extension, open
   submission 1, assert six criterion cards render. Run manually.
2. Handle `parsed_output === null`, timeouts, and missing selectors with the
   states defined in the design. Confirm each one by forcing it.
3. Prompt regression: rerun `analyze-all` and diff against frozen fixtures
   after any prompt edit.
4. Write `README.md` with setup and the demo script.
5. Rehearse the demo three times from a cold start, including a backend
   restart mid-session to confirm replay works.

## Cut list, in order

1. Playwright smoke test
2. Running-mean line and summary row in the dashboard
3. Session replay from `chrome.storage.session`
4. Whole Session tab
