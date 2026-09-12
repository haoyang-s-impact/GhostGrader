/**
 * Everything that touches Moodle's quiz manual-grading DOM
 * (mod/quiz/report.php?mode=grading). Reading and writing both live here so
 * a Moodle theme change, or another LMS, means editing one file.
 *
 * Page anatomy (Moodle 4.x / 5.x, Boost theme):
 *   form#manualgradingform
 *     h4 "Attempt number N for Student Name (email)"
 *     div.que.essay#question-{qubaid}-{slot}
 *       .formulation .qtext            question text (same for every attempt)
 *       .formulation .qtype_essay_response   the student's answer
 *       .comment .graderinfo           "Information for graders" (the marking notes)
 *       textarea[name="q{qubaid}:{slot}_-comment"]  comment, enhanced by TinyMCE
 *       input[name="q{qubaid}:{slot}_-mark"]        the mark
 *       input[name="q{qubaid}:{slot}_-maxmark"]     hidden, the maximum
 *     input[type=submit] "Save and show next"
 */

export interface PageContext {
  courseLmsId: string;
  courseName: string;
  quizLmsId: string;
  quizName: string;
  questionLmsId: string;
  slot: number;
  questionTitle: string;
  questionText: string;
  maxMark: number;
  graderInfo: string;
  /** From the "Attempts to grade" option, e.g. "Those that need grading (24)". */
  attemptsTotal: number;
}

export interface PageAttempt {
  /** `${qubaid}:${slot}`, the LMS-side key. */
  lmsId: string;
  qubaId: string;
  attemptNumber: number;
  studentName: string;
  studentEmail: string;
  text: string;
  element: HTMLElement;
  markInput: HTMLInputElement;
  commentEditorId: string;
}

export interface GradingPage {
  context: PageContext;
  attempts: PageAttempt[];
  form: HTMLFormElement;
  submitButton: HTMLElement | null;
}

export function isManualGradingPage(root: Document = document): boolean {
  return Boolean(root.getElementById("manualgradingform")) && /mode=grading/.test(root.location?.search ?? "");
}

function hidden(root: ParentNode, name: string): string {
  return root.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value ?? "";
}

function text(el: Element | null | undefined): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Text that keeps the structure a model needs: table rows become
 * "cell | cell" lines, block elements become line breaks. Plain textContent
 * would glue "Country Weather Population" into one word soup.
 */
export function richText(el: Element | null | undefined): string {
  if (!el) return "";
  const out: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out.push((node.textContent ?? "").replace(/\s+/g, " "));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const e = node as Element;
    const tag = e.tagName;
    if (tag === "SCRIPT" || tag === "STYLE") return;
    if (tag === "TR") {
      const cells = [...e.children].map((c) => richText(c).trim());
      out.push(cells.join(" | ") + "\n");
      return;
    }
    if (tag === "BR") {
      out.push("\n");
      return;
    }
    const block = /^(P|DIV|TABLE|UL|OL|LI|H[1-6]|BLOCKQUOTE|PRE)$/.test(tag);
    if (block) out.push("\n");
    for (const child of e.childNodes) walk(child);
    if (block) out.push("\n");
  };
  walk(el);
  return out
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function parseGradingPage(root: Document = document): GradingPage | null {
  const form = root.getElementById("manualgradingform") as HTMLFormElement | null;
  if (!form) return null;
  const ques = [...form.querySelectorAll<HTMLElement>(".que")];
  if (ques.length === 0) return null;

  // The options form on the same page carries the ids we need.
  const optionsForm = [...root.querySelectorAll("form")].find((f) => f.querySelector('input[name="qid"]') && f !== form) ?? root;
  const quizLmsId = hidden(optionsForm, "id") || new URLSearchParams(root.location?.search ?? "").get("id") || "";
  const questionLmsId = hidden(optionsForm, "qid") || new URLSearchParams(root.location?.search ?? "").get("qid") || "";
  const slot = Number(hidden(optionsForm, "slot") || new URLSearchParams(root.location?.search ?? "").get("slot") || 1) || 1;

  const courseLink = [...root.querySelectorAll<HTMLAnchorElement>('a[href*="course/view.php?id="]')];
  const courseLmsId = courseLink[0]?.href.match(/course\/view\.php\?id=(\d+)/)?.[1] ?? "";
  const courseName = courseLink.map((a) => text(a)).sort((a, b) => b.length - a.length)[0] ?? "Course";

  const gradingHeading = [...root.querySelectorAll("h2, h3")].map((h) => text(h)).find((t) => /^Grading question/i.test(t)) ?? "";
  const questionTitle = gradingHeading.replace(/^Grading question\s*\d*\s*:\s*/i, "").trim() || `Question ${slot}`;
  const attemptsOption = [...root.querySelectorAll("option")].find((o) => /\(\d+\)/.test(text(o)) && (o as HTMLOptionElement).selected);
  const attemptsTotal = Number(text(attemptsOption).match(/\((\d+)\)/)?.[1] ?? 0) || 0;

  const first = ques[0]!;
  const context: PageContext = {
    courseLmsId,
    courseName,
    quizLmsId,
    quizName: text(root.querySelector("h1")) || "Quiz",
    questionLmsId,
    slot,
    questionTitle,
    questionText: richText(first.querySelector(".qtext")),
    maxMark: Number(form.querySelector<HTMLInputElement>('input[name$="-maxmark"]')?.value ?? 0) || 0,
    graderInfo: richText(first.querySelector(".graderinfo")),
    attemptsTotal,
  };

  // Walk the form in document order so each .que picks up the h4 above it.
  const attempts: PageAttempt[] = [];
  let heading = "";
  const walker = root.createTreeWalker(form, NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode() as HTMLElement | null;
  while (node) {
    if (node.tagName === "H4" && /Attempt number/i.test(node.textContent ?? "")) heading = text(node);
    if (node.classList.contains("que")) {
      const m = node.id.match(/^question-(\d+)-(\d+)$/);
      const qubaId = m?.[1] ?? "";
      const qslot = Number(m?.[2] ?? slot) || slot;
      const lmsId = `${qubaId}:${qslot}`;
      const markInput = form.querySelector<HTMLInputElement>(`input[name="q${lmsId}_-mark"]`);
      const textarea = form.querySelector<HTMLTextAreaElement>(`textarea[name="q${lmsId}_-comment"]`);
      const hm = heading.match(/Attempt number\s+(\d+)\s+for\s+(.+?)\s*(?:\(([^)]*)\))?$/i);
      if (qubaId && markInput) {
        attempts.push({
          lmsId,
          qubaId,
          attemptNumber: Number(hm?.[1] ?? 1) || 1,
          studentName: hm?.[2]?.trim() || `Attempt ${qubaId}`,
          studentEmail: hm?.[3]?.trim() ?? "",
          text: richText(node.querySelector(".qtype_essay_response") ?? node.querySelector(".answer")),
          element: node,
          markInput,
          commentEditorId: textarea?.id ?? `q${lmsId}_-comment_id`,
        });
      }
    }
    node = walker.nextNode() as HTMLElement | null;
  }

  const submitButton = form.querySelector<HTMLElement>('input[type="submit"], button[type="submit"]');
  return { context, attempts, form, submitButton };
}

export function parseMark(raw: string): number | null {
  const t = raw.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Set the mark the way a user would, so Moodle's own listeners fire. */
export function writeMark(attempt: PageAttempt, points: number) {
  const el = attempt.markInput;
  el.value = String(points);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Escape text into a paragraph of HTML for the TinyMCE comment. */
export function toCommentHtml(feedback: string): string {
  const esc = feedback.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch]!);
  return `<p>${esc.replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>")}</p>`;
}
