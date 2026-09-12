import { LMS_API } from "./api";
import { assignmentView } from "./views/assignment";
import { coursesView } from "./views/courses";
import { gradebookView } from "./views/gradebook";

const app = document.getElementById("app")!;

/**
 * Hash router.
 *   #/courses                       course list
 *   #/assignments/:id               questions and submissions
 *   #/assignments/:id/gradebook     students × questions, filled by Ghost Grader pushes
 */
async function route() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  try {
    if (parts[0] === "assignments" && parts[1] && parts[2] === "gradebook") return await gradebookView(app, decodeURIComponent(parts[1]));
    if (parts[0] === "assignments" && parts[1]) return await assignmentView(app, decodeURIComponent(parts[1]));
    if (parts[0] !== "courses") return void (location.hash = "#/courses");
    await coursesView(app);
  } catch (err) {
    app.innerHTML = `<main class="sg-page"><div class="sg-error">${err instanceof Error ? err.message : "Something went wrong."} Is the mock LMS server running at ${LMS_API}?</div><p><a href="#/courses" class="sg-link">Back to courses</a></p></main>`;
  }
}

window.addEventListener("hashchange", route);
if (!location.hash) location.hash = "#/courses";
void route();
