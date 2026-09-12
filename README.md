# Ghost Grader

A browser-native grading copilot. A Chrome extension sits beside the LMS grading
view and, as the teacher works, aligns each student response to the rubric with
quoted evidence, warns when a deduction drifts from earlier decisions for the
same omission, drafts rubric-tied feedback on request, and charts scoring
strictness over the session.

It never grades on its own. Nothing is written into the LMS until the teacher
clicks a button.

## What is in the repo

| Path | What it is |
|---|---|
| `apps/mock-lms` | A Canvas SpeedGrader look-alike with one assignment, a six-criterion rubric, and fifteen seeded essays. Runs on port 5173. |
| `apps/extension` | Manifest V3 Chrome extension. Content script observes the page and renders a side panel with Alignment, Consistency, and Session tabs. |
| `apps/api` | Hono server on port 8787. Calls Claude for rubric alignment, holds the session's grading decisions, runs drift detection. |
| `packages/shared` | Zod schemas, the drift algorithm, the seeded dataset, and a deterministic mock analyzer. |
| `docs/plans` | Design document and implementation plan. |

## Quick start

Requires Node 20.19+ and pnpm 10.

```bash
pnpm install
pnpm build                 # builds the extension into apps/extension/dist
pnpm dev                   # starts the API (8787) and the mock LMS (5173)
```

Then load the extension in Chrome:

1. Open `chrome://extensions`, enable Developer mode.
2. Click "Load unpacked" and pick `apps/extension/dist`.
3. Open http://localhost:5173. The Ghost Grader panel appears on the right.

### Real Claude analysis

Copy `apps/api/.env.example` to `apps/api/.env` and set `ANTHROPIC_API_KEY`.
Restart the API. The panel chip switches from "Mock mode" to "Claude".

Without a key the API runs a deterministic mock analyzer built from the
dataset's ground truth, so the whole demo works offline. The chip says
"Mock mode" so nobody mistakes it for model output.

## Demo script

1. Open submissions 1 to 3 and score them normally. Watch the Alignment tab
   show band, evidence quotes, and missing-concept tags per criterion.
2. On submission 4, give "Reversibility and dynamic equilibrium" 2.5 points.
3. Jump to submission 11 (same omission) and give it 0 points.
4. A Consistency Alert appears: "-2.5 on #4, -5 here, same omission. Align?"
   Click "Align to #4" to write 2.5 into the LMS input, or "Keep mine".
5. Click "Insert into comment" to drop the drafted feedback into the comment
   box, then edit and submit as usual.
6. Open the Session tab for the strictness chart and running mean.

## Tests

```bash
pnpm test                  # unit tests: drift algorithm, fixtures, API routes, extension helpers
pnpm typecheck
pnpm --filter @gg/extension e2e:install   # once: downloads Chromium for Playwright
pnpm e2e                   # end-to-end: loads the built extension into Chromium and runs the demo script
```

The end-to-end run starts the API in mock mode and the mock LMS itself.

## How drift detection works

Every score the teacher enters becomes a decision: criterion, points,
deduction, and the missing-concept tags the alignment step found for that
criterion. For the same criterion, earlier decisions sharing a tag are
compared. If the deduction spread exceeds `max(1.5, 20% of the criterion
maximum)`, an alert names both submissions. The comparison is deterministic
and instant; the semantic part comes from the tags, which Claude extracts from
a closed vocabulary per criterion. "Keep mine" records an override for that
pair so it is not raised again.

## Real LMS later

All DOM access is in `apps/extension/src/content/selectors.ts`. Swapping the
mock page for Canvas means rewriting that file. The production path is LTI 1.3
plus the Canvas REST API for rubric and submission data, with the extension
remaining the real-time observer.
