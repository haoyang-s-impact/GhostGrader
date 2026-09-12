import { chromium, expect, test, type BrowserContext, type Page, type Worker } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { API_PORT, MOODLE_URL } from "../playwright.config";

const here = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(here, "../dist");
const API = `http://localhost:${API_PORT}`;
const GRADING_URL = process.env.MOODLE_GRADING_URL ?? `${MOODLE_URL}/mod/quiz/report.php?id=157&mode=grading&slot=1&qid=172&grade=needsgrading`;
const MOODLE_USER = process.env.MOODLE_USER ?? "admin";
const MOODLE_PASSWORD = process.env.MOODLE_PASSWORD ?? "Admin123!";

let context: BrowserContext;
let page: Page;
let extensionId: string;

const panel = (sel: string) => page.locator(`[data-gg-panel] ${sel}`);
const attemptRows = () => panel("[data-gg-attempt]");
const markInputs = () => page.locator('#manualgradingform input[name$="_-mark"]');

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "gg-ext-")), {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${distDir}`, `--load-extension=${distDir}`],
  });
  let sw: Worker | undefined = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent("serviceworker");
  extensionId = new URL(sw.url()).host;

  // Point the extension at the throwaway API through its options page.
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.locator("#apiBase").fill(API);
  await options.locator("#teacherId").fill("t-demo");
  await options.locator("#save").click();
  await expect(options.locator("#status")).toHaveText("Saved");
  await options.close();

  // Log into Moodle.
  page = await context.newPage();
  await page.goto(`${MOODLE_URL}/login/index.php`, { waitUntil: "domcontentloaded" });
  await page.locator("#username").fill(MOODLE_USER);
  await page.locator("#password").fill(MOODLE_PASSWORD);
  await page.locator("#loginbtn").click();
  await expect(page).not.toHaveURL(/login\/index\.php/);
});

test.afterAll(async () => {
  await context?.close();
});

async function openGrading() {
  // Moodle keeps loading fonts, icons and AJAX strings for a long time; the panel only needs the DOM.
  await page.goto(GRADING_URL, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#manualgradingform .que").first()).toBeVisible();
  await expect(page.locator("[data-gg-panel]")).toBeVisible();
  await expect(page.locator("[data-gg-panel]")).toHaveAttribute("data-gg-state", "ready");
}

test("panel mounts on the Moodle grading page, syncs the question and lists every attempt with a rubric-referenced mark", async () => {
  await openGrading();
  const count = await page.locator("#manualgradingform .que").count();
  await expect(attemptRows()).toHaveCount(count);
  await expect(panel("[data-gg-question-title]")).toContainText("Comparing countries");
  await expect(panel("[data-gg-rubric-note]")).toContainText(/drafted/i);
  await expect(attemptRows().first().locator("[data-gg-suggested]")).toHaveText(/^\d+(\.\d+)?\s*\/\s*10$/);
  await expect(panel("[data-gg-mode]")).toHaveText(/Mock mode/);
});

test("Use writes the rubric-referenced mark and the feedback into Moodle's own mark box and TinyMCE comment", async () => {
  await openGrading();
  // TinyMCE initializes after the DOM is ready; wait for the first editor before using it.
  const editorFrame = page.frameLocator("#manualgradingform .que >> nth=0 >> iframe.tox-edit-area__iframe");
  await expect(page.locator("#manualgradingform .que >> nth=0 >> iframe.tox-edit-area__iframe")).toBeAttached({ timeout: 60_000 });
  const first = attemptRows().first();
  const suggested = (await first.locator("[data-gg-suggested]").textContent())!.split("/")[0]!.trim();
  await first.locator("[data-gg-use]").click();
  await expect(markInputs().first()).toHaveValue(suggested);
  await expect(editorFrame.locator("body")).toContainText(/\w+/);
  const student = (await first.locator("[data-gg-student]").textContent())!.split(" ")[0]!;
  await expect(editorFrame.locator("body")).toContainText(student);
});

test("a mark that contradicts the rubric raises the rubric check while typing; Approve applies the referenced mark", async () => {
  await openGrading();
  const first = attemptRows().first();
  const suggested = Number((await first.locator("[data-gg-suggested]").textContent())!.split("/")[0]);
  const wrong = suggested >= 5 ? 0 : 10;
  await markInputs().first().fill(String(wrong));
  await expect(panel("[data-gg-check]")).toBeVisible();
  await expect(panel("[data-gg-check]")).toContainText(`You entered ${wrong}`);
  await panel("[data-gg-approve-check]").click();
  await expect(markInputs().first()).toHaveValue(String(suggested));
  await expect(panel("[data-gg-check]")).toHaveCount(0);
});

test("Save is intercepted: inconsistent marks across two students raise the consistency alert before Moodle saves", async () => {
  await openGrading();
  // Two students on this page share the rubric gaps under the mock analyzer; grade them very differently.
  await markInputs().nth(0).fill("10");
  await markInputs().nth(1).fill("2");
  const urlBefore = page.url();
  await page.locator('#manualgradingform input[type="submit"]').click();
  await expect(panel("[data-gg-alert]")).toBeVisible();
  await expect(panel("[data-gg-alert]")).toContainText(/graded them 10/);
  expect(page.url()).toBe(urlBefore); // not saved yet
  await expect(page.locator("#manualgradingform")).toBeVisible();

  // Keep mine records an override; the panel then tells the teacher to save again.
  await panel("[data-gg-keep]").click();
  await expect(panel("[data-gg-alert]")).toHaveCount(0);
  await expect(panel("[data-gg-save-hint]")).toContainText(/Save/);
});
