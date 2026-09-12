import { coursesView } from "./views/courses";
import { rubricEditorView } from "./views/rubric-editor";
import { speedGraderView } from "./views/speedgrader";

const app = document.getElementById("app")!;
const SEEDED_ASSIGNMENT = "chem-haber-eq";

/**
 * Hash router.
 *   #/courses                         dashboard
 *   #/assignments/new/:courseId       rubric editor, new
 *   #/assignments/:id/rubric          rubric editor, existing
 *   #/grade/:assignmentId/:index      SpeedGrader
 *   #N                                legacy: SpeedGrader for the seeded assignment
 */
async function route() {
  const hash = location.hash.replace(/^#\/?/, "");
  try {
    if (/^\d+$/.test(hash)) return void (location.hash = `#/grade/${SEEDED_ASSIGNMENT}/${hash}`);
    const parts = hash.split("/").filter(Boolean);
    if (parts[0] === "grade" && parts[1]) return await speedGraderView(app, parts[1], Number(parts[2] ?? 1) || 1);
    if (parts[0] === "assignments" && parts[1] === "new") return await rubricEditorView(app, { courseId: parts[2] });
    if (parts[0] === "assignments" && parts[1] && parts[2] === "rubric") return await rubricEditorView(app, { assignmentId: parts[1] });
    if (parts[0] !== "courses") return void (location.hash = "#/courses");
    await coursesView(app);
  } catch (err) {
    app.innerHTML = `<main class="sg-page"><div class="sg-error">${err instanceof Error ? err.message : "Something went wrong."} Is the API running on port 8787?</div><p><a href="#/courses" class="sg-link">Back to dashboard</a></p></main>`;
  }
}

window.addEventListener("hashchange", route);
if (!location.hash) location.hash = "#/courses";
void route();
