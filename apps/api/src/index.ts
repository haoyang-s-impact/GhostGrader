import "dotenv/config";
import { serve } from "@hono/node-server";
import { selectAnalyzer } from "./analyzer";
import { createApp } from "./app";

const analyzer = selectAnalyzer();
const app = createApp({ analyzer });
const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Ghost Grader API listening on http://localhost:${info.port}`);
  console.log(
    analyzer.mode === "claude"
      ? "Analyzer: Claude (claude-opus-5, structured outputs)"
      : "Analyzer: MOCK (no ANTHROPIC_API_KEY set, or GG_MOCK=1). Set a key in apps/api/.env for real analysis.",
  );
});
