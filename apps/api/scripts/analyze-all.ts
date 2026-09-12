/**
 * Runs the analyzer over every seeded answer and writes results to
 * packages/shared/fixtures/analysis/<answerId>.json for prompt regression
 * checks. With a real key it also prints cache usage so you can confirm each
 * question's system prompt is served from the prompt cache after its first call.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { answers, assignment, questionById } from "@gg/shared";
import { selectAnalyzer } from "../src/analyzer";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "../../../packages/shared/fixtures/analysis");
mkdirSync(outDir, { recursive: true });

const info = selectAnalyzer(process.env, (m) => console.log("   ", m));
console.log(`Analyzer mode: ${info.mode} (${info.model})`);

for (const a of answers) {
  const question = questionById(assignment, a.questionId);
  if (!question) throw new Error(`Answer ${a.id} points at unknown question ${a.questionId}`);
  const result = await info.analyze(a, assignment, question);
  writeFileSync(join(outDir, `${a.id}.json`), JSON.stringify(result, null, 2) + "\n");
  const missing = result.criteria.filter((c) => c.missingConcepts.length).map((c) => `${c.criterionId}:${c.missingConcepts.join("+")}`);
  console.log(`Q${question.index} ${a.id.padEnd(10)} ${a.studentName.padEnd(16)} ${String(result.suggestedTotal).padStart(4)}/${result.maxTotal}  ${missing.join(" ") || "(no missing concepts)"}`);
}
