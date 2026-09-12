# Ghost Grader: Hackathon Design

Date: 2026-09-12
Status: validated with the team, ready for implementation planning

## Goal

Build a working end-to-end demo of Ghost Grader for a hackathon. A Chrome
extension sits beside a mock Canvas SpeedGrader page and, as the teacher grades,
shows rubric alignment for the open submission, warns when a scoring decision
drifts from earlier decisions in the same session, drafts rubric-tied feedback
on request, and charts scoring strictness over the session.

Non-goals for this version: real LMS integration, authentication, persistence
across sessions, autonomous grading, a vector database.

## Decisions and rationale

| Decision | Choice | Why |
|---|---|---|
| Delivery vehicle | Chrome extension (Manifest V3) | Only option that observes the teacher grading in real time. LTI 1.3 opens in its own iframe and cannot watch SpeedGrader; it also needs admin access to a real Canvas instance, which the team lacks. |
| LMS target | Self-built mock SpeedGrader page | No LMS access. A mock page gives stable selectors and a scriptable drift scenario. |
| Language | TypeScript everywhere | One toolchain, shared types between extension, backend, and mock page. |
| Retrieval | No vector database | Per-assignment context (rubric, objectives, anchors, essay) is a few thousand tokens and fits in every prompt. Retrieving a subset of six criteria adds infrastructure and a wrong-criterion failure mode without improving accuracy. |
| "RAG" framing | Retrieval over the session's grading history | The consistency alert is retrieval over prior decisions. Rubric constraint comes from structured outputs and a locked system prompt. |
| Model | Claude Opus 5, adaptive thinking, structured outputs | Alignment and feedback need reasoning quality. Drift detection is deterministic and makes no model call. |
| Drift detection | Deterministic threshold over LLM-extracted missing-concept tags | Instant on the score-change hot path. Semantic because the tags come from the alignment call. |

Production path, stated in the pitch but not built: LTI 1.3 plus the Canvas
REST API for rubric and submission data, with the extension remaining the
real-time observer. A vector store becomes useful for cross-semester grading
memory or very large anchor banks.

## Architecture

Monorepo with pnpm workspaces.

```
GhostGrader/
  apps/
    mock-lms/      Vite static page imitating Canvas SpeedGrader
    extension/     Vite + CRXJS Manifest V3 extension, React side panel
    api/           Hono server on Node, Claude TypeScript SDK
  packages/
    shared/        Zod schemas and TypeScript types shared by all apps
  docs/plans/
```

### apps/mock-lms

- Left pane: student essay. Right pane: rubric table with one row per
  criterion and a points input. Below: comment box. Top: previous/next
  submission navigation and a submission counter.
- Loads a seeded JSON dataset from `packages/shared/fixtures`.
- Every element the extension reads or writes carries a stable
  `data-gg-*` attribute (`data-gg-submission-id`, `data-gg-essay`,
  `data-gg-criterion-id`, `data-gg-points`, `data-gg-comment`).

### apps/extension

- Content script injects a side panel (plain DOM container, no iframe) and
  observes the page with a `MutationObserver`.
- Reads: current submission ID and essay text, rubric criteria and entered
  points, comment box contents.
- Writes to the page only when the teacher clicks "Insert into comment".
- Side panel is React with three tabs: Alignment, Consistency, Session.
- Selectors live in one file so a real Canvas adapter can replace them later.
- Mirrors decisions to `chrome.storage.session` so a backend restart during
  the demo can be recovered by replay.

### apps/api

- Hono server. Holds the only copy of the Claude API key.
- Session cache: in-memory map keyed by assignment ID, holding an ordered
  list of decisions.
- Routes:
  - `POST /analyze` : essay plus rubric in, structured alignment plus feedback
    draft out.
  - `POST /decision` : record a scoring decision, return any drift alert.
  - `GET /session/:id` : all decisions with timestamps for the dashboard.

### packages/shared

Zod schemas for `Assignment`, `Rubric`, `Criterion`, `Submission`,
`AnalysisResult`, `Decision`, `DriftAlert`. The same schema used for Claude
structured output is the one the extension validates against.

## Data flow

### Flow A: teacher opens a submission

1. Content script detects the submission ID change, scrapes essay and rubric,
   posts to `/analyze`.
2. Backend builds one request to Claude Opus 5:
   - System block, marked for prompt caching: assignment prompt, learning
     objectives, full rubric with point bands, anchor responses, and grading
     rules that forbid judging anything outside the rubric.
   - User message: the student's essay.
   - `output_config.format` from the shared Zod `AnalysisResult` schema.
3. `AnalysisResult` contains, per criterion: `level` (rubric band),
   `evidence` (verbatim quotes or empty), `missing_concepts` (short tags such
   as `reversibility`), `confidence`. Plus `feedback_draft`: two to four
   encouraging sentences naming one strength and one criterion-tied
   improvement.
4. Panel renders a checklist beside the real rubric and shows the draft under
   an "Insert into comment" button.

### Flow B: teacher enters a score

1. On each points input change the content script posts
   `{ submissionId, criterionId, points, missingConcepts }` to `/decision`.
   `missingConcepts` comes from the Flow A result for that criterion.
2. Backend appends the decision to the session cache.
3. Drift check, deterministic: for the same criterion, find prior decisions
   that share at least one missing-concept tag. Compare deductions
   (criterion max minus points). If the spread exceeds the threshold
   (1.5 points or 20 percent of the criterion max, whichever is larger),
   return a `DriftAlert` with both submission numbers, both deductions, and
   the shared tag.
4. Panel shows a "Consistency Alert" card with two actions: "Align to
   earlier" (sets the current points to match) and "Keep mine" (records an
   override so the same pair is not flagged again).

### Flow C: session dashboard

`GET /session/:id` returns every decision in order. The Session tab renders
deduction per criterion over submission order as a line chart, plus a running
mean deduction, so drift is visible as grading proceeds.

## Claude API usage

- Model `claude-opus-5`, adaptive thinking (default), effort `high` for
  `/analyze`.
- `client.messages.parse` with `zodOutputFormat(AnalysisResultSchema)`.
- System block carries `cache_control: { type: "ephemeral" }` so the rubric
  and anchors are cached across all fifteen submissions.
- Server-side refusal fallback enabled as recommended for Opus 5.
- `max_tokens` 16000, non-streaming; the response is short structured JSON.

## Demo dataset

Topic: chemistry. Prompt: "Explain why the reaction is reversible and how
temperature affects the equilibrium position."

Six criteria: reversibility concept, Le Chatelier reasoning, use of evidence,
clarity, structure, mechanics.

Fifteen essays, generated once with Claude, hand-checked, frozen as JSON.
Roughly five omit reversibility, three omit temperature reasoning, the rest
mixed. Submissions 4 and 11 are near-twins with the same omission.

Demo script: grade 1 to 3 normally. On 4, deduct 2.5 on reversibility. Jump to
11, deduct 5 on reversibility. The alert fires referencing submission 4.
Click "Insert into comment" to show feedback. Open the Session tab to show the
drift curve.

## Error handling

- Claude call fails or times out: panel shows a retry button. Manual grading
  is never blocked because the extension only reads until "Insert" is clicked.
- `parsed_output` is null: one automatic retry, then a "Could not analyze"
  state.
- `stop_reason` is `refusal`: treated like a parse failure.
- A selector finds nothing: log and show "Waiting for submission".
- Backend restart: replay decisions from `chrome.storage.session`.

## Testing

- Vitest unit tests for drift detection, table-driven: same tag above and
  below threshold, different tags, re-scoring the same submission, override
  suppression.
- Schema round-trip tests for every seeded essay and fixture analysis result.
- One Playwright smoke test: load mock page with the extension, open
  submission 1, assert six criteria render in the panel. Run manually before
  the pitch.
- Prompt quality checked by hand against the fifteen essays; outputs saved
  under `fixtures/analysis/` to catch regressions after prompt edits.

## Open items for the implementation plan

- Exact rubric point bands and the anchor responses.
- Panel visual design.
- Whether "Align to earlier" writes the points input directly or only
  suggests the value.
