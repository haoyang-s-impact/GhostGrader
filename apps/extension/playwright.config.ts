import { defineConfig } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * End-to-end against the real Moodle at MOODLE_URL (default the local Docker
 * instance on :8080) with the built extension loaded into Chromium. The
 * Ghost Grader API is started by Playwright on its own port with the mock
 * analyzer and a throwaway database, so a run never touches the dev store.
 * The extension is pointed at that API through its options page.
 */
export const API_PORT = process.env.E2E_API_PORT ?? "18787";
export const MOODLE_URL = process.env.MOODLE_URL ?? "http://localhost:8080";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  webServer: [
    {
      command: "pnpm --filter @gg/api start",
      url: `http://localhost:${API_PORT}/health`,
      reuseExistingServer: false,
      env: { GG_MOCK: "1", PORT: API_PORT, NODE_ENV: "test", GG_DB_PATH: join(tmpdir(), `gg-ext-e2e-${Date.now()}.sqlite`) },
      cwd: "../..",
    },
  ],
});
