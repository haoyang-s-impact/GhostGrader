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

declare const __GG_EXTENSION_DIST__: string;

/**
 * Embed mode: with ?embed=1 the page loads the built extension script itself,
 * so the panel works without installing the extension in Chrome. Handy for
 * demos and screen shares. The real thing is still the extension.
 */
function embedGhostGrader() {
  if (!new URLSearchParams(location.search).has("embed")) return;
  if (document.getElementById("ghost-grader-host") || document.getElementById("gg-embed-script")) return;
  const s = document.createElement("script");
  s.id = "gg-embed-script";
  s.src = `/@fs${__GG_EXTENSION_DIST__}/content.js?t=${Date.now()}`;
  s.onerror = () => console.warn("Ghost Grader embed: build the extension first (pnpm --filter @gg/extension build).");
  document.head.appendChild(s);
}

window.addEventListener("hashchange", route);
if (!location.hash) location.hash = "#/courses";
void route();
embedGhostGrader();
