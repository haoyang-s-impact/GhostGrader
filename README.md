# Ghost Grader

A grading copilot that works inside the LMS. On Moodle's quiz manual-grading
page a Chrome extension opens a panel beside the marks; teachers can also grade
the seeded demo in Ghost Grader's own web app. As they work, the agent reads each answer
against that question's rubric and suggests a grade with reasoning and quoted
evidence. It flags a grade that contradicts the rubric, and compares the grade
with those already given to other students with the same gaps on the same
question. It also drafts student-specific feedback and charts leniency over the
session.

It never grades on its own. A suggestion becomes a grade only when the teacher
clicks Submit.

Each teacher owns courses, each course owns assignments, and each assignment
holds questions. **Each question carries its own rubric**, and Ghost Grader is
bound to exactly that rubric when it looks at answers to that question.

## What is in the repo

| Path | What it is |
|---|---|
| `apps/extension` | Chrome extension for Moodle: reads the quiz manual-grading page, suggests a rubric-referenced mark per attempt, fills Moodle's mark box and comment on Use, checks marks against the rubric as you type, and holds Save while cross-student inconsistencies are open. |
| `apps/web` | The Ghost Grader app (React, port 5173): courses, the grading workspace, a gradebook, and the rubric editor. |
| `apps/api` | Hono server on port 8787. Teacher-scoped data (courses, assignments, questions, rubrics, answers, grades, push records) in a SQLite database, LLM rubric analysis (OpenRouter, OpenAI or Claude), grading sessions, cross-student comparison, and the LMS sync layer. |
| `packages/shared` | Zod schemas, rubric math and grade rollup, the comparison algorithm, the seeded dataset, and a deterministic mock analyzer. |
| `docs/plans` | The original design and implementation plan, from the earlier Chrome-extension version. |

## Quick start

Requires Node 20.19+ and pnpm 10.

```bash
pnpm install
pnpm dev                   # starts the API (8787) and the web app (5173)
```

Open http://localhost:5173 and click **Grade** on "Equilibrium in the Haber
Process". That's all the setup there is: no browser extension and no LMS.

The seeded assignment has two questions and their student answers already
loaded:

- **Q1, Reversibility and temperature**: 30 points, 6 criteria, 15 answers.
- **Q2, Pressure and yield**: 15 points, 3 criteria, 5 answers.

A second course, **ENG 8: English**, holds "Grade 8 English: Open-Ended
Questions": five short-answer questions, each with its own rubric, and 10
students who answered all of them.

- **Q1, Comparing two countries**: 10/5/0. Both weather and population compared
  correctly earns 10; one feature, or a grammar slip that doesn't block meaning,
  earns 5. Spelling and punctuation are ignored.
- **Q2 and Q3, Listening: Barbara's and Adam's orders**: 20 points, 5 per menu
  item (soup, main course, dessert, beverage) that matches the answer key.
  Spelling is forgiven. Each question carries its recording, the recording's
  transcript and the restaurant menu. The files are in
  `apps/web/public/media/eng8/`.
- **Q4, Kevin's excuse**: 10/5/0 against the dialogue.
- **Q5, Weekend activities**: 12 points across three analytic criteria (task
  completion, grammar, vocabulary), 4 points each.

### LLM providers and fallback

Copy `apps/api/.env.example` to `apps/api/.env` and set any of:

- `OPENROUTER_API_KEY` (optional `OPENROUTER_MODEL`, default
  `openai/gpt-5-mini`). Any OpenAI-compatible model on OpenRouter.
- `OPENAI_API_KEY` (optional `OPENAI_MODEL`, default `gpt-5-mini`).
- `ANTHROPIC_API_KEY` for Claude Opus 5 with structured outputs.

Before changing the model, run
`pnpm --filter @gg/api compare-models <assignmentId> <questionId> --models=...`
to see each candidate's marks side by side on a question's real answers; on
the seeded Moodle question gpt-5-mini matched the rubric on 16 of 16 answers
where gpt-4o-mini matched 10.

They form a chain in that order. The first configured provider is primary.
When a call fails for any reason (outage, rate limit, refusal, or malformed
output after one retry), the same request is retried on the next one. The
Grade tab shows which provider produced each result ("via openai"), and the
API log records every fallback.

Without any key, the API runs a deterministic mock analyzer, so the whole demo
works offline. For Q1 it uses hand-checked ground truth; for Q2 it falls back
to a keyword scan of the rubric's concept tags. The chip says "Mock mode" so
nobody mistakes it for model output. `GG_MOCK=1` forces the mock even with keys
(the tests use this).

## Grading inside Moodle

1. `pnpm --filter @gg/extension build`, then in Chrome open `chrome://extensions`,
   turn on Developer mode, **Load unpacked**, pick `apps/extension/dist`.
   The options page holds the API URL (default `http://localhost:8787`), the
   web app URL and the teacher id.
2. Open a quiz's **Results → Manual grading** page in Moodle, for example
   `/mod/quiz/report.php?id=157&mode=grading&slot=1&qid=172&grade=needsgrading`.
3. The panel lists every attempt on the page with a rubric-referenced mark.
   The first time a question is seen its rubric is drafted from Moodle's
   "Information for graders"; the note in the panel links to the rubric editor
   so you can refine it. Click an attempt for the per-criterion reasoning,
   quoted evidence and a feedback draft. **Use** writes the mark into Moodle's
   mark box and the feedback into the comment editor.
4. Type a mark yourself and the Checks tab tells you when it contradicts the
   rubric. **Approve** applies the referenced mark and feedback; **Keep mine**
   dismisses it.
5. Click Moodle's **Save and show next**. Ghost Grader records every mark on
   the page, compares each with the marks you already gave other students on
   this question, and, if any pair is inconsistent, holds the save and shows
   the pair with **Align** and **Keep mine**. Click Save again and Moodle saves
   as usual. Nothing reaches Moodle except through Moodle's own form.

No extension handy? Load `apps/extension/dist/content.js` as a plain script on
the page after setting `window.__ggSettings = { apiBase: "http://localhost:8787" }`.

## The grading workspace

Three columns:

- **Left:** the question tabs (Q1, Q2) and the students who answered that
  question, with the grade you gave each one.
- **Middle:** the question, the student's answer, the grade box, the feedback
  box, and **Submit grade**.
- **Right:** the Ghost Grader panel, with Grade, Checks and Session tabs.

Typing a grade is a draft. Only **Submit** records it, and only a recorded
grade is compared with other students. Reopening a student shows the grade and
feedback you submitted.

## Defining questions and rubrics

From the home page, click **Rubrics** on an assignment, or **+ New assignment**
on a course. For each question:

1. Write the question students answer, and optionally a short title.
2. Set "Grade out of" if the grade should be on a different scale than the
   rubric total.
3. Add criteria. For each one, set a title, description, max points, the point
   bands (level, points, descriptor), and the **concept tags**: a closed
   vocabulary the AI may report as missing for that criterion. Tags are what
   make the checks explainable ("missing reversibility").
4. Optionally add anchor responses.

Everything the AI sees for a question comes from this definition. The prompt
is rebuilt when a rubric changes.

## One grade, two kinds of intervention

The Grade tab shows the rubric-referenced grade for the open answer, a
one-sentence reason, the per-criterion breakdown with quoted evidence and
missing concepts, and a **Use** button.

**Rubric check.** When your draft grade diverges from the rubric-referenced
grade by more than 1.5 points or 10% of the scale, the Checks tab says so: "You
gave 28 of 30. Referenced against this question's rubric, this answer earns
20.5 because it is missing reversibility, dynamic equilibrium", with the
per-criterion breakdown. **Approve** puts the referenced grade and the drafted
feedback into the form. **Keep mine** dismisses it for that answer.

**Consistency alert.** When you submit, the grade is compared with the grades
you already gave other students **on the same question**. The first student has
no one to compare with. From the second on, students with the same missing
concepts (or who are both complete) are compared by their offset from the
rubric-referenced grade. Say you were 3.5 points lenient with Daniel for
missing reversibility, and 4.5 points strict with Kavya for the same gap. The
panel names Daniel, shows both grades, and offers to treat Kavya the same way.
**Keep mine** records an override for that pair.

## Demo script

1. Open **Grade** on the Haber assignment. Aisha (#1) opens on Q1. The Grade
   tab shows 30/30 with the reasoning per criterion. Click **Use**, then
   **Submit grade**.
2. Open **Daniel Okafor** (#4) and type 28. The rubric check says the answer
   earns 20.5 because reversibility and dynamic equilibrium are missing. Click
   **Keep mine**, change the grade to 24, and submit.
3. Open **Kavya Sharma** (#11), who has the same gap. Type 16, dismiss the
   rubric check, and submit. The consistency alert names Daniel, shows 24 vs 16
   against the same rubric-referenced 20.5, and offers **Align to 24**.
4. Click **Use as feedback** on the Grade tab to drop the drafted feedback into
   the feedback box, edit it, and submit.
5. Switch to **Q2**. It has its own 3-criterion rubric, and your Q1 grades are
   never compared with Q2 grades.
6. Open the **Session** tab for the grades and the rubric-referenced grades on
   this question, and the mean offset. From the home page, **Grades** shows each
   student's per-question grades rolled up to an assignment total.

### Short-answer demo: the English exam

1. Open **Grade** on "Grade 8 English: Open-Ended Questions". Elif (#1) opens
   on Q1 with a 10/10 suggestion.
2. Open **Mehmet Kaya** (#2), who compared only the weather, and type 10. The
   rubric check says the answer earns 5 because the population comparison is
   missing. Click **Keep mine** and submit.
3. Open **Burak Arslan** (#6), who has the same gap. Type 0, keep it, and
   submit. The consistency alert names Mehmet, shows 10 vs 0 against the same
   suggestion of 5, and offers **Align to 10**.
4. Switch to **Q2**, a listening task. Play the dialogue under the prompt, open
   **Transcript** to read it, and open **Menu** to see what students chose from.
   Answers are scored by how many menu items match the key. Mehmet (#2) and
   Ayşe (#5) both miss the dessert, so both are suggested 15. Ece (#10) wrote
   only "Kebab" for the Mixed Kebab, so she gets 15 as well.
5. Switch to **Q5** to see a paragraph scored on three analytic criteria.

## Storage

Everything lives in one SQLite file, `apps/api/data/ghost-grader.sqlite`
(override with `GG_DB_PATH`). The schema is in `apps/api/src/db/schema.ts`
and is applied by migrations at API startup, so pulling the repo and starting
the API is enough. An empty database is seeded with the demo teachers,
courses, questions and answers. Two people, or two browsers, see the same
grades. An existing database is never reseeded. If yours predates the English
exam, run `rm apps/api/data/ghost-grader.sqlite*` and restart the API to pick
it up. This also clears your grades.

### Listening questions: audio and transcripts

A question can carry `media`: audio clips and images students work from, shown
under the prompt while you grade. Answers are still text. The analyzer never
hears audio. It reads the clip's transcript, which is made once, when the
question is set up:

```bash
pnpm --filter @gg/api transcribe-media [path/to/assignment.json]
```

This sends each untranscribed clip under `apps/web/public/` to OpenAI's
transcription API (`OPENAI_API_KEY`, model `gpt-4o-transcribe` or
`OPENAI_TRANSCRIBE_MODEL`). It then writes the text into the fixture so it can
be committed. Grading, tests and mock mode never need the key. The anchor
responses stay the answer key. The transcript tells the analyzer what students
heard.

If you have a `data/ghost-grader.json` from an earlier version, run
`pnpm --filter @gg/api import-json` once to copy it in.

## How the comparison works

Every submitted grade becomes a decision: the points, the rubric-referenced
suggestion at that moment, the missing-concept tags the analysis found, and
your feedback. Re-submitting an answer replaces its decision, so the session
holds each answer's latest grade and only that is ever compared.

Earlier decisions **on the same question**, from other students, that share a
tag (or are both complete) are compared by offset, teacher points minus
suggested points. If the offsets differ by more than `max(1.5, 10% of the
scale)`, an alert names the earlier student and recommends the grade that
applies the same offset here.

The comparison is deterministic and instant. The semantic part comes from the
tags, which the model extracts from the closed vocabulary the teacher defined
per criterion. Scoping to one question matters: tags and point scales belong
to a question's rubric, so the same tag name on two different questions is a
coincidence of vocabulary, not the same gap.

## Connecting an LMS

No LMS is needed for the demo. The architecture is built for one, though:

- Everything LMS-specific lives behind the `LmsAdapter` interface in
  `apps/api/src/lms/`: list assignments, pull questions and answers, push
  grades. The LMS owns questions and answers; the rubric stays Ghost Grader's.
- **Pull** is an idempotent upsert keyed on LMS ids. Pulling twice creates
  nothing new, a resubmitted answer updates in place and keeps its grade, and
  rubrics you already wrote survive.
- **Push** is always an explicit teacher action and is idempotent. Each grade
  carries a content-addressed reference (answer, points, feedback), and only
  grades the LMS doesn't already hold are sent.
- `GG_LMS=canvas` selects the Canvas adapter, which is a stub today. Its file
  lists the Canvas REST endpoints to implement. Once an adapter is configured,
  the grading workspace shows a **Push grades to LMS** control.

## Tests

```bash
pnpm test                  # unit tests: comparison, rubric math and rollup, push diffing, fixtures, providers, sync, tenant-scoped API routes
pnpm typecheck
pnpm --filter @gg/web e2e:install   # once: downloads Chromium for Playwright
pnpm e2e                   # end-to-end: runs the demo script in a real browser
pnpm --filter @gg/extension e2e   # end-to-end against a local Moodle (set MOODLE_URL, MOODLE_USER, MOODLE_PASSWORD, MOODLE_GRADING_URL)
```

The end-to-end run starts the API (mock analyzer, throwaway database) and the
web app itself. If dev servers already hold ports 8787 and 5173, run
`E2E_API_PORT=18787 E2E_WEB_PORT=15173 pnpm e2e`.

## Tenancy and storage

The API scopes every request by the `X-Teacher-Id` header, which the web app
sets from its "Signed in as" switcher. A real deployment replaces the header
with an LTI launch or OAuth session.

Data lives in the SQLite database described under Storage above.
