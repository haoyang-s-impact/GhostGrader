import { expect, test, type Page } from "@playwright/test";

/**
 * The demo script, end to end, against the real API in mock-analyzer mode:
 * grade question 1, catch a rubric check, catch the cross-student
 * consistency alert, align, confirm question 2 is compared separately, and
 * see the rolled-up grades.
 */
const A = "chem-haber-eq";
const Q1 = "q-haber-1";
const Q2 = "q-haber-2";

const panel = (page: Page, sel: string) => page.locator(`[data-gg-panel] ${sel}`);

async function open(page: Page, questionId: string, answerId: string) {
  await page.goto(`/#/grade/${A}/${questionId}/${answerId}`);
  await expect(page.locator(`[data-gg-panel][data-gg-analysis="ready"]`)).toBeVisible();
}

async function enterGrade(page: Page, points: number) {
  await page.locator("[data-grade-input]").fill(String(points));
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ request }) => {
  const api = `http://localhost:${process.env.E2E_API_PORT ?? "8787"}`;
  await request.delete(`${api}/session/${A}`, { headers: { "x-teacher-id": "t-demo" } });
});

test("home lists the seeded assignment with both questions and its answers", async ({ page }) => {
  await page.goto("/");
  const row = page.locator(`[data-assignment="${A}"]`);
  await expect(row).toContainText("2 questions");
  await expect(row).toContainText("20 answers");
  await row.locator("[data-start-grading]").click();
  await expect(page.locator("[data-student-name]")).toHaveText("Aisha Rahman");
});

test("analysis shows the rubric-referenced grade, and Use + Submit records it", async ({ page }) => {
  await open(page, Q1, "sub-01");
  await expect(panel(page, "[data-gg-suggested]").first()).toContainText("30");
  await expect(panel(page, "[data-gg-criterion-card]")).toHaveCount(6);
  await panel(page, "[data-gg-apply-grade]").click();
  await expect(page.locator("[data-grade-input]")).toHaveValue("30");
  await expect(page.locator("[data-unsubmitted]")).toBeVisible();
  await page.locator("[data-submit]").click();
  await expect(page.locator("[data-saved]")).toBeVisible();
  await expect(page.locator(`[data-student-link="sub-01"] .ws-points`)).toHaveText("30");
});

test("a grade far from the rubric raises the rubric check, and approving fills grade and feedback", async ({ page }) => {
  await open(page, Q1, "sub-04");
  await enterGrade(page, 28);
  const check = panel(page, "[data-gg-check]");
  await expect(check).toContainText("20.5");
  await expect(check).toContainText("reversibility");
  await panel(page, "[data-gg-approve-check]").click();
  await expect(page.locator("[data-grade-input]")).toHaveValue("20.5");
  await expect(page.locator("[data-comment]")).toHaveValue(/^Daniel,/);
});

test("same gap graded differently for two students raises the consistency alert, and Align applies it", async ({ page }) => {
  // Daniel: lenient by 3.5 against the rubric.
  await open(page, Q1, "sub-04");
  await enterGrade(page, 24);
  await panel(page, "[data-gg-dismiss-check]").click();
  await page.locator("[data-submit]").click();
  await expect(page.locator("[data-saved]")).toBeVisible();

  // Kavya: the same gap, strict by 4.5.
  await open(page, Q1, "sub-11");
  await enterGrade(page, 16);
  await panel(page, "[data-gg-dismiss-check]").click();
  await page.locator("[data-submit]").click();
  const alert = panel(page, "[data-gg-alert]");
  await expect(alert).toContainText("Daniel Okafor");
  await expect(alert).toContainText("reversibility");
  await panel(page, "[data-gg-align]").click();
  await expect(page.locator("[data-grade-input]")).toHaveValue("24");
  await expect(page.locator("[data-unsubmitted]")).toBeVisible();

  // Opening the Session tab refreshes history but must not overwrite the aligned draft.
  await panel(page, '[data-gg-tab="session"]').click();
  await expect(panel(page, "[data-gg-chart]")).toBeVisible();
  await expect(page.locator("[data-grade-input]")).toHaveValue("24");
  await page.locator("[data-submit]").click();
  await expect(page.locator("[data-saved]")).toBeVisible();
});

test("reopening a graded student shows their submitted grade", async ({ page }) => {
  await open(page, Q1, "sub-04");
  await expect(page.locator("[data-grade-input]")).toHaveValue("24");
  await expect(page.locator("[data-saved]")).toBeVisible();
});

test("question 2 has its own rubric and its own comparisons", async ({ page }) => {
  await open(page, Q2, "q2-sub-04");
  await expect(panel(page, "[data-gg-criterion-card]")).toHaveCount(3);
  await expect(page.locator("[data-progress]")).toHaveText("0 of 5 graded");
  const suggested = Number(await panel(page, "[data-gg-apply-grade]").innerText().then((t) => t.replace(/[^\d.]/g, "")));
  await enterGrade(page, suggested);
  await page.locator("[data-submit]").click();
  await expect(page.locator("[data-saved]")).toBeVisible();
  // Question 1's grades never produce an alert here.
  await expect(panel(page, "[data-gg-alert]")).toHaveCount(0);
});

test("the gradebook rolls per-question grades up per student", async ({ page }) => {
  await page.goto(`/#/grades/${A}`);
  const daniel = page.locator('[data-student="stu-04"]');
  await expect(daniel).toContainText("24 / 30");
  await expect(page.locator('[data-total="stu-04"]')).toContainText("/ 45");
  await expect(page.locator('[data-total="stu-01"]')).toContainText("1 of 2 graded");
});
