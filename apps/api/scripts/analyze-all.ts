/**
 * Runs the analyzer over every seeded submission and writes results to
 * packages/shared/fixtures/analysis/<id>.json for prompt regression checks.
 * With a real key it also prints cache usage so you can confirm the system
 * prompt is being served from the prompt cache after the first call.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assignment, submissions } from "@gg/shared";
import { selectAnalyzer } from "../src/analyzer";
import { createClaudeAnalyzer } from "../src/claude";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "../../../packages/shared/fixtures/analysis");
mkdirSync(outDir, { recursive: true });

const info = selectAnalyzer();
const analyze = info.mode === "claude" ? createClaudeAnalyzer({ log: (m) => console.log("   ", m) }) : info.analyze;
console.log(`Analyzer mode: ${info.mode}`);

for (const s of submissions) {
  const result = await analyze(s, assignment);
  writeFileSync(join(outDir, `${s.id}.json`), JSON.stringify(result, null, 2) + "\n");
  const missing = result.criteria.filter((c) => c.missingConcepts.length).map((c) => `${c.criterionId}:${c.missingConcepts.join("+")}`);
  console.log(`${s.id} ${s.studentName.padEnd(16)} ${missing.join(" ") || "(no missing concepts)"}`);
}
