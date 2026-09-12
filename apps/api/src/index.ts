import "dotenv/config";
import { serve } from "@hono/node-server";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { selectAnalyzer } from "./analyzer";
import { createApp } from "./app";
import { selectLmsAdapter } from "./lms/select";
import { Store } from "./store";

const here = dirname(fileURLToPath(import.meta.url));
const dataPath = process.env.GG_DATA_PATH ?? join(here, "../data/ghost-grader.json");
const log = (m: string) => console.log("  ", m);

const analyzer = selectAnalyzer(process.env, log);
const lms = selectLmsAdapter(process.env);
const store = new Store(dataPath, {}, log);
const app = createApp({ analyzer, store, lms });
const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Ghost Grader API listening on http://localhost:${info.port}`);
  console.log(`Data file: ${dataPath}`);
  console.log(lms ? `LMS adapter: ${lms.name} (${process.env.GG_LMS_BASE_URL ?? "no base URL"})` : "LMS: none configured; grading the seeded questions and answers.");
  if (analyzer.mode === "mock") {
    console.log("Analyzer: MOCK (no provider key set, or GG_MOCK=1). Set OPENROUTER_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY in apps/api/.env for real analysis.");
  } else {
    const chain = [analyzer, ...analyzer.fallbacks].map((p) => `${p.mode} (${p.model})`).join(" -> ");
    console.log(`Analyzer chain: ${chain}`);
  }
});
