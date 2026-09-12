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
  await context.request.delete(`${API}/session/${ASSIGNMENT}`, { headers: TEACHER });
  page = await context.newPage();
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
});

test.afterAll(async () => {
  await context?.close();
});

const panel = (sel: string) => page.locator(`[data-gg-panel] ${sel}`);
const gradeInput = () => page.locator("[data-gg-grade]");

async function openSubmission(index: number, assignmentId = ASSIGNMENT) {
  await page.goto("/#/courses");
  await page.goto(`/#/grade/${assignmentId}/${index}`);
  await expect(page.locator(`[data-gg-submission-index="${index}"]`).first()).toBeVisible();
  await expect(page.locator("[data-gg-panel]")).toHaveAttribute("data-gg-analysis", "ready");
}

async function setGrade(points: number) {
  await gradeInput().fill(String(points));
  await page.waitForTimeout(700); // observer debounce (400 ms) plus the round trip
}

test("panel shows one rubric-referenced grade and the per-criterion reasoning", async () => {
  await openSubmission(1);
  await expect(panel(".gg-title")).toHaveText("Ghost Grader");
  await expect(panel("[data-gg-mode]")).toHaveText(/Mock mode|Claude|gpt|claude/);
  await expect(page.locator("[data-gg-criterion-id]")).toHaveCount(0); // no rubric table in the grader
  await expect(panel(".gg-suggest-n")).toContainText("30");
  await expect(panel("[data-gg-criterion-card]")).toHaveCount(6);
  await expect(panel("[data-gg-summary]")).not.toBeEmpty();
});

test("rubric check: a wrong grade is flagged with the rubric-referenced grade; approving applies it with feedback", async () => {
  await openSubmission(4);
  await expect(panel(".gg-suggest-n")).toContainText("20.5");
  await expect(panel("[data-gg-criterion-card='reversibility'] .gg-tag").first()).toHaveText("missing: reversibility");

  // Teacher gives 28 of 30 to a response the rubric rates 20.5.
  await setGrade(28);
  const check = panel("[data-gg-check]");
  await expect(check).toBeVisible();
  await expect(check).toContainText("You gave 28 of 30");
  await expect(check).toContainText("earns 20.5");
  await expect(check).toContainText("missing reversibility, dynamic equilibrium");
  await expect(check.locator(".gg-breakdown li")).toHaveCount(6);
  await page.screenshot({ path: "test-results/demo-rubric-check.png" });

  await panel("[data-gg-approve-check]").click();
  await expect(gradeInput()).toHaveValue("20.5");
  await expect(page.locator("[data-gg-comment]")).toHaveValue(/^Daniel,/);
  await expect(panel("[data-gg-check]")).toHaveCount(0);
  await page.waitForTimeout(700);
  await expect(panel("[data-gg-check]")).toHaveCount(0);
});

test("first student has no one to compare with; the second is compared with the first", async () => {
  // Student #4: lenient by 3.5 over the rubric. Keep it despite the rubric check.
  await openSubmission(4);
  await setGrade(24);
  await expect(panel("[data-gg-check]")).toBeVisible();
  await panel("[data-gg-dismiss-check]").click();
  await expect(panel("[data-gg-no-alert]")).toBeVisible();

  // Student #11 has the same gap. Grading 16 is 4.5 under the rubric: 8 points harsher than #4.
  await openSubmission(11);
  await expect(panel(".gg-suggest-n")).toContainText("20.5");
  await setGrade(16);
  const alert = panel("[data-gg-alert]");
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("Daniel Okafor");
  await expect(alert).toContainText("(#4)");
  await expect(alert).toContainText("reversibility");
  await expect(alert).toContainText("graded them 24");
  await expect(alert).toContainText("entered 16");
  await page.screenshot({ path: "test-results/demo-consistency-alert.png" });

  // One-click feedback lands in the LMS comment box, addressed to the student.
  await panel("[data-gg-tab='alignment']").click();
  await panel("[data-gg-insert]").click();
  await expect(page.locator("[data-gg-comment]")).toHaveValue(/^Kavya,/);

  // Align treats #11 like #4: 20.5 + 3.5 = 24.
  await panel("[data-gg-tab='consistency']").click();
  await panel("[data-gg-align]").click();
  await expect(gradeInput()).toHaveValue("24");
  await expect(panel("[data-gg-alert]")).toHaveCount(0);
  await page.waitForTimeout(700);
  await expect(panel("[data-gg-alert]")).toHaveCount(0);

  // Session dashboard reflects both students and the alert.
  await panel("[data-gg-tab='session']").click();
  await expect(panel("[data-gg-stat-graded]")).toHaveText("2");
  await expect(panel("[data-gg-stat-alerts]")).toHaveText("1");
  await expect(panel("[data-gg-stat-aligned]")).toHaveText("1");
  await expect(panel("[data-gg-chart] [data-gg-point]")).toHaveCount(2);
  await expect(panel("[data-gg-stat-offset]")).toHaveText("+3.5");
});

test("keep mine suppresses the same pair on re-grade", async () => {
  await openSubmission(4);
  await setGrade(24);
  await panel("[data-gg-dismiss-check]").click();
  await openSubmission(11);
  await setGrade(16);
  await expect(panel("[data-gg-alert]")).toBeVisible();
  await panel("[data-gg-keep]").click();
  await expect(panel("[data-gg-alert]")).toHaveCount(0);
  await setGrade(15);
  await panel("[data-gg-tab='consistency']").click();
  await expect(panel("[data-gg-alert]")).toHaveCount(0);
});

test("'Use' applies the rubric-referenced grade directly from the Grade tab", async () => {
  await openSubmission(15);
  await panel("[data-gg-apply-grade]").click();
  await expect(gradeInput()).toHaveValue("30");
});

test("multi-tenant: a second teacher defines their own rubric, graded out of 100, and Ghost Grader references it", async () => {
  await page.goto("/#/courses");
  await page.locator("#teacher-switch").selectOption("t-second");
  await expect(page.locator("[data-gg-teacher-id]")).toHaveAttribute("data-gg-teacher-id", "t-second");
  await expect(page.locator("[data-course-id='c-hist210']")).toBeVisible();
  await expect(page.locator("[data-course-id='c-chem101']")).toHaveCount(0);

  await page.locator("[data-course-id='c-hist210'] [data-new-assignment]").click();
  await page.locator("#f-title").fill("Causes of the First World War");
  await page.locator("#f-prompt").fill("Explain how alliance systems and nationalism contributed to the outbreak of war in 1914.");
  await page.locator("#f-total").fill("100");
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

  await expect(page.locator("[data-add-submission]").first()).toBeVisible();
  await page.locator("[data-add-submission] [name='studentName']").first().fill("Ada Lovelace");
  await page.locator("[data-add-submission] [name='text']").first().fill("The alliance blocs meant that a regional crisis caused escalation across the whole continent within weeks.");
  await page.locator("[data-add-submission] button[type='submit']").first().click();

  await expect(page.locator("[data-gg-panel]")).toHaveAttribute("data-gg-analysis", "ready");
  await expect(gradeInput()).toHaveAttribute("data-gg-grade-max", "100");
  await expect(panel("[data-gg-criterion-card]")).toHaveCount(2);
  await expect(panel(".gg-suggest-n")).toContainText("/ 100");
  await expect(panel("[data-gg-criterion-card='nationalism'] .gg-tag").first()).toHaveText("missing: nationalism");
  await expect(panel("[data-gg-feedback-draft]")).toContainText("Ada,");

  // 95/100 for a response missing nationalism entirely contradicts the rubric; approve writes the referenced grade.
  await setGrade(95);
  await expect(panel("[data-gg-check]")).toBeVisible();
  await panel("[data-gg-approve-check]").click();
  await expect(gradeInput()).toHaveValue("50");
  await expect(page.locator("[data-gg-comment]")).toHaveValue(/^Ada,/);
});
