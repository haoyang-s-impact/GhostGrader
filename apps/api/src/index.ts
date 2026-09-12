import "dotenv/config";
import { serve } from "@hono/node-server";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { selectAnalyzer } from "./analyzer";
import { createApp } from "./app";
import { Store } from "./store";

const here = dirname(fileURLToPath(import.meta.url));
const dataPath = process.env.GG_DATA_PATH ?? join(here, "../data/ghost-grader.json");

const analyzer = selectAnalyzer();
const store = new Store(dataPath);
const app = createApp({ analyzer, store });
const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Ghost Grader API listening on http://localhost:${info.port}`);
  console.log(`Data file: ${dataPath}`);
  console.log(
    analyzer.mode === "claude"
      ? "Analyzer: Claude (claude-opus-5, structured outputs)"
      : "Analyzer: MOCK (no ANTHROPIC_API_KEY set, or GG_MOCK=1). Set a key in apps/api/.env for real analysis.",
  );
});
