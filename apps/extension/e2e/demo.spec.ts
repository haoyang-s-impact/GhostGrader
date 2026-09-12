import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(here, "../dist");
const API = "http://localhost:8787";
const ASSIGNMENT = "chem-haber-eq";

let context: BrowserContext;
let page: Page;

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "gg-e2e-")), {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${distDir}`, `--load-extension=${distDir}`],
  });
  // Fresh server session so earlier runs cannot leak decisions into this one.
  await context.request.delete(`${API}/session/${ASSIGNMENT}`);
  page = await context.newPage();
  await page.addInitScript(() => localStorage.clear());
});

test.afterAll(async () => {
  await context?.close();
});

async function openSubmission(index: number) {
  await page.goto(`/#${index}`);
  await expect(page.locator(`[data-gg-submission-index="${index}"]`).first()).toBeVisible();
  await expect(page.locator("[data-gg-panel]")).toHaveAttribute("data-gg-analysis", "ready");
}

async function setPoints(criterionId: string, points: number) {
  const input = page.locator(`[data-gg-criterion-id="${criterionId}"] [data-gg-points]`);
  await input.fill(String(points));
  await page.waitForTimeout(700); // observer debounce (400 ms) plus the round trip
}

test("panel mounts and shows six aligned criteria for submission 1", async () => {
  await openSubmission(1);
  await expect(page.locator("[data-gg-panel] .gg-title")).toHaveText("Ghost Grader");
  await expect(page.locator("[data-gg-panel] [data-gg-mode]")).toHaveText(/Mock mode|Claude/);
  await expect(page.locator("[data-gg-panel] [data-gg-criterion-card]")).toHaveCount(6);
  await expect(page.locator("[data-gg-panel] [data-gg-criterion-card='reversibility'] .gg-level")).toHaveText("Exemplary");
});

test("demo script: -2.5 on #4 then -5 on #11 raises a consistency alert; insert and align work", async () => {
  await openSubmission(4);
  await expect(page.locator("[data-gg-panel] [data-gg-criterion-card='reversibility'] .gg-tag").first()).toHaveText("missing: reversibility");
  await setPoints("reversibility", 2.5);
  await page.locator("[data-gg-panel] [data-gg-tab='consistency']").click();
  await expect(page.locator("[data-gg-panel] [data-gg-no-alert]")).toBeVisible();

  await openSubmission(11);
  await setPoints("reversibility", 0);
  const alert = page.locator("[data-gg-panel] [data-gg-alert]");
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("submission #4");
  await expect(alert).toContainText("−2.5");
  await expect(alert).toContainText("−5");
  await expect(alert).toContainText("reversibility");
  await page.screenshot({ path: "test-results/demo-consistency-alert.png" });

  // One-click feedback lands in the LMS comment box, addressed to the student.
  await page.locator("[data-gg-panel] [data-gg-tab='alignment']").click();
  await page.locator("[data-gg-panel] [data-gg-insert]").click();
  await expect(page.locator("[data-gg-comment]")).toHaveValue(/^Kavya,/);
  await expect(page.locator("[data-gg-panel] [data-gg-insert]")).toHaveText(/Inserted/);

  // Align to the earlier decision writes 2.5 into the LMS input and clears the alert.
  await page.locator("[data-gg-panel] [data-gg-tab='consistency']").click();
  await page.locator("[data-gg-panel] [data-gg-align]").click();
  await expect(page.locator(`[data-gg-criterion-id="reversibility"] [data-gg-points]`)).toHaveValue("2.5");
  await expect(page.locator("[data-gg-panel] [data-gg-alert]")).toHaveCount(0);
  await page.waitForTimeout(700);

  // Session dashboard reflects the decisions and the alert.
  await page.locator("[data-gg-panel] [data-gg-tab='session']").click();
  await expect(page.locator("[data-gg-panel] [data-gg-stat-graded]")).toHaveText("2");
  await expect(page.locator("[data-gg-panel] [data-gg-stat-alerts]")).toHaveText("1");
  await expect(page.locator("[data-gg-panel] [data-gg-stat-aligned]")).toHaveText("1");
  await expect(page.locator("[data-gg-panel] [data-gg-chart] [data-gg-series='reversibility'] circle")).toHaveCount(2);
});

test("keep mine suppresses the same pair on re-score", async () => {
  await openSubmission(4);
  await setPoints("reversibility", 2.5);
  await openSubmission(11);
  await setPoints("reversibility", 0);
  await expect(page.locator("[data-gg-panel] [data-gg-alert]")).toBeVisible();
  await page.locator("[data-gg-panel] [data-gg-keep]").click();
  await expect(page.locator("[data-gg-panel] [data-gg-alert]")).toHaveCount(0);
  await setPoints("reversibility", 0.5);
  await page.locator("[data-gg-panel] [data-gg-tab='consistency']").click();
  await expect(page.locator("[data-gg-panel] [data-gg-no-alert]")).toBeVisible();
});
