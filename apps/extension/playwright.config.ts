import { defineConfig } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:5173" },
  webServer: [
    {
      command: "pnpm --filter @gg/api start",
      url: "http://localhost:8787/health",
      reuseExistingServer: true,
      // A throwaway data file so end-to-end runs never touch the dev store.
      env: { GG_MOCK: "1", PORT: "8787", NODE_ENV: "test", GG_DATA_PATH: join(tmpdir(), `gg-e2e-${Date.now()}.json`) },
      cwd: "../..",
    },
    {
      command: "pnpm --filter @gg/mock-lms dev",
      url: "http://localhost:5173",
      reuseExistingServer: true,
      cwd: "../..",
    },
  ],
});
