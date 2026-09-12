# Ghost Grader

A browser-native grading copilot. A Chrome extension sits beside the LMS grading
view. The teacher enters one grade per student. As they work, the agent reads
the response against the course's rubric and suggests a grade with reasoning
and quoted evidence, flags a grade that contradicts the rubric, compares the
grade with those already given to other students with the same gaps, drafts
student-specific feedback, and charts leniency over the session.

It never grades on its own. Nothing is written into the LMS until the teacher
clicks a button.

It is multi-tenant: each teacher owns courses, each course owns assignments,
and each assignment carries its own rubric. Ghost Grader is bound to exactly
the rubric the teacher defined for that assignment.

## What is in the repo

| Path | What it is |
|---|---|
| `apps/mock-lms` | A Canvas look-alike: course dashboard, rubric editor, and SpeedGrader. Seeded with one assignment, a six-criterion rubric, and fifteen essays. Runs on port 5173. |
| `apps/extension` | Manifest V3 Chrome extension. Content script observes the page and renders a side panel with Alignment, Consistency, and Session tabs. |
| `apps/api` | Hono server on port 8787. Teacher-scoped LMS data (courses, assignments, rubrics, submissions) in a JSON file store, LLM rubric analysis (OpenRouter or Claude), grading sessions, cross-student comparison. |
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
4. After every `pnpm build`, click the reload icon on the extension's card.

**No extension handy?** Open http://localhost:5173/?embed=1 instead. In embed
mode the mock LMS loads the built panel script itself, so the same panel
appears without installing anything. Good for demos and screen shares.

### LLM provider

Copy `apps/api/.env.example` to `apps/api/.env` and set one of:

- `OPENROUTER_API_KEY` (plus optional `OPENROUTER_MODEL`, default
  `openai/gpt-4o-mini`). Any OpenAI-compatible model on OpenRouter works; the
  panel chip shows the model name.
- `ANTHROPIC_API_KEY` for Claude Opus 5 with structured outputs.

OpenRouter wins if both are set. Without either, the API runs a deterministic
mock analyzer built from the dataset's ground truth, so the whole demo works
offline. The chip says "Mock mode" so nobody mistakes it for model output.
`GG_MOCK=1` forces the mock even with a key (the tests use this).

## Defining a rubric

1. Open http://localhost:5173, which lands on the course dashboard. Use the
   "Signed in as" switcher in the header to change teacher; each teacher sees
   only their own courses.
2. Add a course, then "+ New assignment" to open the rubric editor.
3. Set "Grade out of" if the single grade should be on a different scale than
   the rubric total (for example 100). For each criterion set a title,
   description, max points, the point bands (level, points, descriptor), and
   the **concept tags**: a closed vocabulary the AI may report as missing for
   that criterion. Tags are what make the checks explainable ("missing
   reversibility").
4. Optionally add anchor responses. Save. You land in SpeedGrader for that
   assignment, where you can paste student submissions.

Everything the AI sees for an assignment comes from this definition. The
prompt is rebuilt when the rubric changes.

## One grade, two kinds of intervention

The grader shows a single grade input and a comment box. The rubric stays
behind the scenes: the agent scores each criterion against its bands, sums
them, and scales the result to the assignment's grade. The Grade tab shows
that rubric-referenced grade, a one-sentence reason, the per-criterion
breakdown with quoted evidence and missing concepts, and a "Use" button.

**Rubric check.** When the teacher's grade diverges from the rubric-referenced
grade by more than 1.5 points or 10% of the scale, the Checks tab says so:
"You gave 28 of 30. Referenced against this course's rubric, this response
earns 20.5 because it is missing reversibility, dynamic equilibrium", with the
per-criterion breakdown. "Approve" writes the referenced grade into the LMS and
inserts the student-specific feedback. "Keep mine" dismisses it for that
student.

**Consistency alert.** Every grade is compared with the grades already given
to other students in the session. The first student has no one to compare
with. From the second on, students with the same missing concepts (or who are
both complete) are compared by their offset from the rubric-referenced grade.
If you were 3.5 points lenient with Daniel for missing reversibility and 4.5
points strict with Kavya for the same gap, the panel names Daniel, shows both
grades, and offers to treat Kavya the same way. "Keep mine" records an
override for that pair.

## Demo script

1. Open submission 1. The Grade tab shows the rubric-referenced grade (30/30
   in mock mode) with the reasoning per criterion. Click "Use" or type a
   grade.
2. Open submission 4 and give it 28. The rubric check says the response earns
   20.5 because reversibility and dynamic equilibrium are missing. Approve to
   apply 20.5 and insert the feedback, or keep 24 to set up the next step.
3. Open submission 11, which has the same gap, and give it 16. The
   consistency alert names Daniel Okafor (#4), shows 24 vs 16 against the same
   rubric-referenced 20.5, and offers "Align to 24".
4. Click "Insert into comment" to drop the drafted feedback into the comment
   box, then edit and submit as usual.
5. Open the Session tab: your grades, the rubric-referenced grades, and the
   mean offset across the session.

## Tests

```bash
pnpm test                  # unit tests: comparison, rubric check, fixtures, providers, tenant-scoped API routes, extension helpers
pnpm typecheck
pnpm --filter @gg/extension e2e:install   # once: downloads Chromium for Playwright
pnpm e2e                   # end-to-end: loads the built extension into Chromium and runs the demo script
```

The end-to-end run starts the API in mock mode and the mock LMS itself.

## How the comparison works

Every grade the teacher enters becomes a decision: points, the
rubric-referenced suggestion at that moment, and the missing-concept tags the
analysis found. Earlier decisions in the session that share a tag (or are
both complete) are compared by offset, teacher points minus suggested points.
If the offsets differ by more than `max(1.5, 10% of the scale)`, an alert
names the earlier student and recommends the grade that applies the same
offset here. The comparison is deterministic and instant; the semantic part
comes from the tags, which the model extracts from the closed vocabulary the
teacher defined per criterion.

## Tenancy and storage

The API scopes every request by the `X-Teacher-Id` header, which the mock LMS
sets from its teacher switcher and the extension reads from the page. A real
deployment replaces the header with an LTI launch or OAuth session. Data
lives in `apps/api/data/ghost-grader.json` (override with `GG_DATA_PATH`),
rewritten atomically on each change; swap the `Store` class for a database
when needed.

## Real LMS later

All DOM access is in `apps/extension/src/content/selectors.ts`. Swapping the
mock page for Canvas means rewriting that file. The production path is LTI 1.3
plus the Canvas REST API for rubric and submission data, with the extension
remaining the real-time observer.
