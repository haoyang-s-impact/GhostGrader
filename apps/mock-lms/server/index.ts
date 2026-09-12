import { serve } from "@hono/node-server";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLmsApp } from "./app";
import { LmsStore } from "./store";

const here = dirname(fileURLToPath(import.meta.url));
const dataPath = process.env.LMS_DATA_PATH ?? join(here, "../data/lms.json");
const port = Number(process.env.LMS_PORT ?? 8788);

const app = createLmsApp({ store: new LmsStore(dataPath) });

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Mock LMS API listening on http://localhost:${info.port}/api/v1`);
  console.log(`LMS data file: ${dataPath}`);
});
