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

/** Type a grade without committing it. A draft: nothing is recorded. */
async function typeGrade(points: number) {
  await gradeInput().fill("");
  await gradeInput().pressSequentially(String(points), { delay: 30 });
  await page.waitForTimeout(700); // observer debounce (400 ms) plus the round trip
}

/** Type a grade and click Submit, which is what makes it a decision. */
async function submitGrade(points: number) {
  await typeGrade(points);
  await submit();
}

async function submit() {
  await page.locator("[data-gg-submit]").click();
  await page.waitForTimeout(700); // marker mutation plus the round trip
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
  await submitGrade(28);
  const check = panel("[data-gg-check]");
  await expect(check).toBeVisible();
  await expect(check).toContainText("You gave 28 of 30");
  await expect(check).toContainText("earns 20.5");
  await expect(check).toContainText("missing reversibility, dynamic equilibrium");
  await expect(check.locator(".gg-breakdown li")).toHaveCount(6);
  await page.screenshot({ path: "test-results/demo-rubric-check.png" });

  await panel("[data-gg-approve-check]").click();
  await expect(gradeInput()).toHaveValue("20.5");
  await submit();
  await expect(page.locator("[data-gg-comment]")).toHaveValue(/^Daniel,/);
  await expect(panel("[data-gg-check]")).toHaveCount(0);
  await page.waitForTimeout(700);
  await expect(panel("[data-gg-check]")).toHaveCount(0);
});

test("first student has no one to compare with; the second is compared with the first", async () => {
  // Student #4: lenient by 3.5 over the rubric. Keep it despite the rubric check.
  await openSubmission(4);
  await submitGrade(24);
  await expect(panel("[data-gg-check]")).toBeVisible();
  await panel("[data-gg-dismiss-check]").click();
  await expect(panel("[data-gg-no-alert]")).toBeVisible();

  // Student #11 has the same gap. Grading 16 is 4.5 under the rubric: 8 points harsher than #4.
  await openSubmission(11);
  await expect(panel(".gg-suggest-n")).toContainText("20.5");
  await submitGrade(16);
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
  // Align writes into the LMS but does not commit; the panel says so.
  await expect(panel("[data-gg-unsubmitted]")).toBeVisible();
  await submit();
  await expect(panel("[data-gg-unsubmitted]")).toHaveCount(0);
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
  await submitGrade(24);
  await panel("[data-gg-dismiss-check]").click();
  await openSubmission(11);
  await submitGrade(16);
  await expect(panel("[data-gg-alert]")).toBeVisible();
  await panel("[data-gg-keep]").click();
  await expect(panel("[data-gg-alert]")).toHaveCount(0);
  await submitGrade(15);
  await panel("[data-gg-tab='consistency']").click();
  await expect(panel("[data-gg-alert]")).toHaveCount(0);
});

test("a grade that is typed but never submitted is not compared with other students", async () => {
  await context.request.delete(`${API}/session/${ASSIGNMENT}`, { headers: TEACHER });
  await openSubmission(4);
  await submitGrade(24);
  await panel("[data-gg-dismiss-check]").click();

  // #11 has the same gap. Typing 16 digit by digit passes through 1, which is
  // wildly out of line with #4 — neither it nor the final 16 may raise an alert
  // while the grade is still a draft.
  await openSubmission(11);
  await gradeInput().fill("");
  await gradeInput().pressSequentially("16", { delay: 250 });
  await page.waitForTimeout(700);
  await expect(panel("[data-gg-alert]")).toHaveCount(0);
  await expect(panel("[data-gg-unsubmitted]")).toBeVisible();

  // The rubric check, which only involves this student, is live regardless.
  await expect(panel("[data-gg-check]")).toBeVisible();

  // The server has heard about #4 only.
  const before = await (await context.request.get(`${API}/session/${ASSIGNMENT}`, { headers: TEACHER })).json();
  expect(before.decisions).toHaveLength(1);

  // Submit is what makes it a decision.
  await submit();
  await expect(panel("[data-gg-alert]")).toBeVisible();
  await expect(panel("[data-gg-alert]")).toContainText("Daniel Okafor");
  const after = await (await context.request.get(`${API}/session/${ASSIGNMENT}`, { headers: TEACHER })).json();
  expect(after.decisions).toHaveLength(2);
});

test("reopening an already submitted student does not record it again", async () => {
  const before = await (await context.request.get(`${API}/session/${ASSIGNMENT}`, { headers: TEACHER })).json();
  await openSubmission(4);
  await openSubmission(11);
  await page.waitForTimeout(700);
  const after = await (await context.request.get(`${API}/session/${ASSIGNMENT}`, { headers: TEACHER })).json();
  expect(after.decisions).toHaveLength(before.decisions.length);
  expect(after.alertsRaised).toBe(before.alertsRaised);
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
  await submitGrade(95);
  await expect(panel("[data-gg-check]")).toBeVisible();
  await panel("[data-gg-approve-check]").click();
  await expect(gradeInput()).toHaveValue("50");
  await submit();
  await expect(page.locator("[data-gg-comment]")).toHaveValue(/^Ada,/);
});
