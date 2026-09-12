/**
 * Model bake-off on one synced question: runs every answer through each
 * model and prints the suggested marks side by side, with an optional
 * expected column. Use it before switching OPENROUTER_MODEL.
 *
 *   pnpm --filter @gg/api compare-models <assignmentId> <questionId> \
 *     --models=openai/gpt-4o-mini,openai/gpt-5-mini,anthropic/claude-sonnet-5 \
 *     [--expected=/path/to/expected.json]   # { "<answer text>": <points>, ... }
 *     [--teacher=t-demo] [--db=/path/to/ghost-grader.sqlite]
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { questionById } from "@gg/shared";
import { createOpenRouterAnalyzer } from "../src/openrouter";
import { Store } from "../src/store";

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const [assignmentId, questionId] = args.filter((a) => !a.startsWith("--"));
if (!assignmentId || !questionId) {
  console.error("usage: compare-models <assignmentId> <questionId> --models=a,b,c [--expected=file.json]");
  process.exit(1);
}
const models = (flag("models") ?? process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini").split(",").map((m) => m.trim()).filter(Boolean);
const teacher = flag("teacher") ?? "t-demo";
const here = dirname(fileURLToPath(import.meta.url));
const store = new Store(flag("db") ?? process.env.GG_DB_PATH ?? join(here, "../data/ghost-grader.sqlite"));
const expected: Record<string, number> = flag("expected") ? JSON.parse(readFileSync(flag("expected")!, "utf8")) : {};
const norm = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
const expectedFor = (text: string) => {
  const key = Object.keys(expected).find((k) => norm(k) === norm(text));
  return key === undefined ? null : expected[key]!;
};

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error("OPENROUTER_API_KEY is not set");
  process.exit(1);
}
const assignment = store.assignment(teacher, assignmentId);
const question = assignment && questionById(assignment, questionId);
if (!assignment || !question) {
  console.error("assignment or question not found for this teacher");
  process.exit(1);
}
const answers = store.answersFor(assignment.id, question.id);
console.log(`${question.title} · ${answers.length} answers · max ${question.totalPoints ?? "rubric"} · anchors ${question.anchors.length}\n`);

const analyzers = models.map((model) => ({ model, analyze: createOpenRouterAnalyzer({ apiKey, model, provider: "openrouter" }) }));
const results: Record<string, Record<string, number | string>> = {};
for (const a of answers) {
  results[a.id] = {};
  await Promise.all(
    analyzers.map(async ({ model, analyze }) => {
      try {
        const r = await analyze(a, assignment, question);
        results[a.id]![model] = r.suggestedTotal;
      } catch (err) {
        results[a.id]![model] = `ERR ${err instanceof Error ? err.message.slice(0, 30) : String(err)}`;
      }
    }),
  );
}

const short = (m: string) => m.split("/").pop()!.slice(0, 18);
const header = ["student".padEnd(16), "exp".padStart(4), ...models.map((m) => short(m).padStart(20)), "answer"].join("  ");
console.log(header);
const agree: Record<string, number> = Object.fromEntries(models.map((m) => [m, 0]));
let withExpected = 0;
for (const a of answers) {
  const exp = expectedFor(a.text);
  if (exp !== null) withExpected++;
  const cells = models.map((m) => {
    const v = results[a.id]![m]!;
    if (exp !== null && v === exp) agree[m]!++;
    return String(v).padStart(20);
  });
  console.log([a.studentName.padEnd(16), (exp === null ? "?" : String(exp)).padStart(4), ...cells, a.text.slice(0, 60)].join("  "));
}
if (withExpected) {
  console.log("\nagreement with expected:");
  for (const m of models) console.log(`  ${short(m).padEnd(20)} ${agree[m]}/${withExpected}`);
}
store.close();
