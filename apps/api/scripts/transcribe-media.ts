/**
 * Transcribes every audio clip in an assignment fixture that has no transcript
 * yet, and writes the text back into the file. Run once when a listening
 * question is set up; transcripts are committed, so grading, tests and mock
 * mode never need a key or send audio anywhere.
 *
 *   pnpm --filter @gg/api transcribe-media [path/to/assignment.json]
 *
 * Needs OPENAI_API_KEY. OPENAI_TRANSCRIBE_MODEL overrides the model. Audio
 * `src` paths are resolved against apps/web/public, where seeded media lives.
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { QuestionMedia } from "@gg/shared";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");
const file = resolve(process.argv[2] ?? join(repo, "packages/shared/fixtures/english8/assignment.json"));
const publicDir = join(repo, "apps/web/public");
const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-transcribe";
const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");

if (!apiKey) {
  console.error("OPENAI_API_KEY is not set (apps/api/.env). Nothing transcribed.");
  process.exit(1);
}

const assignment = JSON.parse(readFileSync(file, "utf8")) as { questions: { id: string; media?: QuestionMedia[] }[] };
let changed = 0;

for (const q of assignment.questions) {
  for (const m of q.media ?? []) {
    if (m.kind !== "audio" || m.transcript) continue;
    if (/^[a-z]+:/i.test(m.src)) throw new Error(`${q.id}: only local media under apps/web/public can be transcribed, got ${m.src}`);
    const path = join(publicDir, m.src);
    const form = new FormData();
    form.append("file", new Blob([readFileSync(path)], { type: "audio/mpeg" }), basename(path));
    form.append("model", model);
    form.append("language", "en");
    form.append("response_format", "json");
    const res = await fetch(`${baseUrl}/audio/transcriptions`, { method: "POST", headers: { authorization: `Bearer ${apiKey}` }, body: form });
    if (!res.ok) throw new Error(`${q.id}: OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const { text } = (await res.json()) as { text: string };
    m.transcript = text.trim();
    changed++;
    console.log(`\n${q.id} · ${m.label} (${model})\n${m.transcript}`);
  }
}

if (changed) writeFileSync(file, JSON.stringify(assignment, null, 2) + "\n");
console.log(`\n${changed} clip(s) transcribed into ${file}.`);
