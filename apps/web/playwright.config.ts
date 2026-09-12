import { defineConfig } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Overridable so an end-to-end run can sit beside dev servers already on the default ports.
const API_PORT = process.env.E2E_API_PORT ?? "8787";
const WEB_PORT = process.env.E2E_WEB_PORT ?? "5173";
const API_URL = `http://localhost:${API_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${WEB_PORT}` },
  webServer: [
    {
      command: "pnpm --filter @gg/api start",
      url: `${API_URL}/health`,
      reuseExistingServer: false,
      // A throwaway database so end-to-end runs never touch the dev store.
      env: { GG_MOCK: "1", PORT: API_PORT, NODE_ENV: "test", GG_DB_PATH: join(tmpdir(), `gg-e2e-${Date.now()}.sqlite`) },
      cwd: "../..",
    },
    {
      command: `pnpm --filter @gg/web dev --port ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      env: { VITE_API_BASE: API_URL },
      cwd: "../..",
    },
  ],
});
