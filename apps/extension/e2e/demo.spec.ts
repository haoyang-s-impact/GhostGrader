import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(here, "../dist");
const API = "http://localhost:8787";
const ASSIGNMENT = "chem-haber-eq";
const TEACHER = { "x-teacher-id": "t-demo" };

let context: BrowserContext;
let page: Page;

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "gg-e2e-")), {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${distDir}`, `--load-extension=${distDir}`],
  });
  // Fresh server session so earlier runs cannot leak decisions into this one.
  await context.request.delete(`${API}/session/${ASSIGNMENT}`, { headers: TEACHER });
  page = await context.newPage();
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
});

test.afterAll(async () => {
  await context?.close();
});

async function openSubmission(index: number, assignmentId = ASSIGNMENT) {
  // Always leave and come back so the page re-renders even when the hash is unchanged.
  await page.goto("/#/courses");
  await page.goto(`/#/grade/${assignmentId}/${index}`);
  await expect(page.locator(`[data-gg-submission-index="${index}"]`).first()).toBeVisible();
  await expect(page.locator("[data-gg-panel]")).toHaveAttribute("data-gg-analysis", "ready");
}

async function setPoints(criterionId: string, points: number) {
  const input = page.locator(`[data-gg-criterion-id="${criterionId}"] [data-gg-points]`);
  await input.fill(String(points));
  await page.waitForTimeout(700); // observer debounce (400 ms) plus the round trip
}

const panel = (sel: string) => page.locator(`[data-gg-panel] ${sel}`);

test("panel mounts and shows six aligned criteria with rubric-derived points for submission 1", async () => {
  await openSubmission(1);
  await expect(panel(".gg-title")).toHaveText("Ghost Grader");
  await expect(panel("[data-gg-mode]")).toHaveText(/Mock mode|Claude/);
  await expect(panel("[data-gg-criterion-card]")).toHaveCount(6);
  await expect(panel("[data-gg-criterion-card='reversibility'] .gg-level")).toHaveText(/Exemplary · 5\/5/);
});

test("rubric check: a score that contradicts the rubric is flagged; approving applies the AI score and feedback", async () => {
  await openSubmission(4);
  await expect(panel("[data-gg-criterion-card='reversibility'] .gg-tag").first()).toHaveText("missing: reversibility");
  await expect(panel("[data-gg-criterion-card='reversibility'] .gg-level")).toHaveText(/Beginning · 0\/5/);

  // Teacher gives full marks on a criterion the rubric-bound analysis says is missing entirely.
  await setPoints("reversibility", 5);
  const check = panel("[data-gg-check]");
  await expect(check).toBeVisible();
  await expect(check).toContainText("You entered 5 of 5");
  await expect(check).toContainText("Beginning (0 pts)");
  await expect(check).toContainText("missing reversibility, dynamic equilibrium");
  await page.screenshot({ path: "test-results/demo-rubric-check.png" });

  await panel("[data-gg-approve-check]").click();
  await expect(page.locator(`[data-gg-criterion-id="reversibility"] [data-gg-points]`)).toHaveValue("0");
  await expect(page.locator("[data-gg-comment]")).toHaveValue(/^Daniel,/);
  await expect(panel("[data-gg-check]")).toHaveCount(0);
  await page.waitForTimeout(700);
  // The approved 0 no longer diverges, so no second check appears.
  await expect(panel("[data-gg-check]")).toHaveCount(0);
});

test("demo script: -2.5 on #4 then -5 on #11 raises a consistency alert; insert and align work", async () => {
  await openSubmission(4);
  await setPoints("reversibility", 2.5);
  // 2.5 vs the rubric's 0 is a divergence of 2.5, so a rubric check appears; the teacher keeps their score.
  await expect(panel("[data-gg-check]")).toBeVisible();
  await panel("[data-gg-dismiss-check]").click();
  await expect(panel("[data-gg-no-alert]")).toBeVisible();

  await openSubmission(11);
  await setPoints("reversibility", 0);
  const alert = panel("[data-gg-alert]");
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("submission #4");
  await expect(alert).toContainText("−2.5");
  await expect(alert).toContainText("−5");
  await expect(alert).toContainText("reversibility");
  await page.screenshot({ path: "test-results/demo-consistency-alert.png" });

  // One-click feedback lands in the LMS comment box, addressed to the student.
  await panel("[data-gg-tab='alignment']").click();
  await panel("[data-gg-insert]").click();
  await expect(page.locator("[data-gg-comment]")).toHaveValue(/^Kavya,/);
  await expect(panel("[data-gg-insert]")).toHaveText(/Inserted/);

  // Align to the earlier decision writes 2.5 into the LMS input and clears the alert.
  await panel("[data-gg-tab='consistency']").click();
  await panel("[data-gg-align]").click();
  await expect(page.locator(`[data-gg-criterion-id="reversibility"] [data-gg-points]`)).toHaveValue("2.5");
  await expect(panel("[data-gg-alert]")).toHaveCount(0);
  await page.waitForTimeout(700);
  // Aligning to 2.5 diverges from the rubric's 0 again; the teacher keeps it.
  await panel("[data-gg-dismiss-check]").click();

  // Session dashboard reflects the decisions, the alert, and the checks.
  await panel("[data-gg-tab='session']").click();
  await expect(panel("[data-gg-stat-graded]")).toHaveText("2");
  await expect(panel("[data-gg-stat-alerts]")).toHaveText("1");
  await expect(panel("[data-gg-stat-aligned]")).toHaveText("1");
  await expect(panel("[data-gg-stat-checks]")).not.toHaveText("0");
  await expect(panel("[data-gg-chart] [data-gg-series='reversibility'] circle")).toHaveCount(2);
});

test("keep mine suppresses the same pair on re-score", async () => {
  await openSubmission(4);
  await setPoints("reversibility", 2.5);
  await panel("[data-gg-dismiss-check]").click();
  await openSubmission(11);
  await setPoints("reversibility", 0);
  await expect(panel("[data-gg-alert]")).toBeVisible();
  await panel("[data-gg-keep]").click();
  await expect(panel("[data-gg-alert]")).toHaveCount(0);
  await setPoints("reversibility", 0.5);
  await panel("[data-gg-tab='consistency']").click();
  await expect(panel("[data-gg-alert]")).toHaveCount(0);
});

test("multi-tenant: a second teacher defines their own rubric and Ghost Grader grades against it", async () => {
  // Switch teacher via the header.
  await page.goto("/#/courses");
  await page.locator("#teacher-switch").selectOption("t-second");
  await expect(page.locator("[data-gg-teacher-id]")).toHaveAttribute("data-gg-teacher-id", "t-second");
  await expect(page.locator("[data-course-id='c-hist210']")).toBeVisible();
  await expect(page.locator("[data-course-id='c-chem101']")).toHaveCount(0);

  // Build an assignment with a two-criterion rubric in the editor.
  await page.locator("[data-course-id='c-hist210'] [data-new-assignment]").click();
  await page.locator("#f-title").fill("Causes of the First World War");
  await page.locator("#f-prompt").fill("Explain how alliance systems and nationalism contributed to the outbreak of war in 1914.");
  const crit = (i: number) => page.locator("[data-criterion-editor]").nth(i);
  await crit(0).locator("[data-c-title]").fill("Alliance systems");
  await crit(0).locator("[data-c-desc]").fill("Explains how the alliance blocs turned a regional crisis into a general war.");
  await crit(0).locator("[data-c-concepts]").fill("alliance, escalation");
  await page.locator("#add-criterion").click();
  await crit(1).locator("[data-c-title]").fill("Nationalism");
  await crit(1).locator("[data-c-desc]").fill("Explains the role of nationalism.");
  await crit(1).locator("[data-c-concepts]").fill("nationalism, balkans");
  await page.screenshot({ path: "test-results/demo-rubric-editor.png", fullPage: true });
  await page.locator("[data-save-rubric]").click();

  // Lands on SpeedGrader with no submissions; add one.
  await expect(page.locator("[data-add-submission]").first()).toBeVisible();
  await page.locator("[data-add-submission] [name='studentName']").first().fill("Ada Lovelace");
  await page.locator("[data-add-submission] [name='text']").first().fill("The alliance blocs meant that a regional crisis caused escalation across the whole continent within weeks.");
  await page.locator("[data-add-submission] button[type='submit']").first().click();

  // The panel analyzes against the new rubric: two criteria, nationalism missing.
  await expect(page.locator("[data-gg-panel]")).toHaveAttribute("data-gg-analysis", "ready");
  await expect(panel("[data-gg-criterion-card]")).toHaveCount(2);
  await expect(panel("[data-gg-criterion-card='alliance_systems'] .gg-level")).toHaveText(/Exemplary/);
  await expect(panel("[data-gg-criterion-card='nationalism'] .gg-tag").first()).toHaveText("missing: nationalism");
  await expect(panel("[data-gg-feedback-draft]")).toContainText("Ada,");

  // Scoring nationalism at full marks contradicts the rubric; approving writes 0 and feedback.
  await setPoints("nationalism", 5);
  await expect(panel("[data-gg-check]")).toBeVisible();
  await panel("[data-gg-approve-check]").click();
  await expect(page.locator(`[data-gg-criterion-id="nationalism"] [data-gg-points]`)).toHaveValue("0");
  await expect(page.locator("[data-gg-comment]")).toHaveValue(/^Ada,/);
});
