import { describe, expect, it } from "vitest";
import { selectAnalyzer } from "../src/analyzer";
import { createApp } from "../src/app";
import { moodleIds, type MoodlePageInput } from "../src/lms/page-sync";
import { parseExampleAnchors, parseGraderInfo } from "../src/rubric-draft";
import { Store } from "../src/store";

const T1 = "t-demo";
const hdr = (teacher: string) => ({ "content-type": "application/json", "x-teacher-id": teacher });

const GRADER_INFO =
  "Rubric 1 (10 points) Score 10: Accurately compares both features (weather and population) in separate sentences and complies with English grammar rules. Spelling and punctuation errors are ignored. Examples: New Zealand is hotter than Canada. " +
  "Score 5: Accurately compares only one feature, or the comparison contains minor structural/grammar errors that do not impede communication. Examples: New Zealand is hotter than Canada. " +
  "Score 0: Blank, factually incorrect comparisons, or sentences that completely violate English grammar. Examples: Canada colder than New Zealand.";

function page(overrides: Partial<MoodlePageInput> = {}): MoodlePageInput {
  return {
    lms: "moodle",
    course: { lmsId: "17", name: "8. Sınıf İngilizce (E8)" },
    quiz: { lmsId: "157", name: "Unit 1–2 Assessment" },
    question: { lmsId: "172", slot: 1, title: "Q1 – Comparing countries (E8.1.W1)", text: "Compare the countries' population and weather.", maxMark: 10, graderInfo: GRADER_INFO },
    attempts: [
      { lmsId: "78:1", attemptNumber: 1, studentName: "Fatma Kaya", studentEmail: "fatma.kaya@example.com", text: "Canada colder than New Zealand. New Zealand is less crowded than Canada." },
      { lmsId: "59:1", attemptNumber: 1, studentName: "Zeynep Kara", studentEmail: "zeynep.kara2@example.com", text: "New Zealand is hotter than Canada. Canada is more crowded than New Zealand." },
    ],
    ...overrides,
  };
}

function mkApp(store = new Store()) {
  return { app: createApp({ analyzer: selectAnalyzer({ GG_MOCK: "1", NODE_ENV: "test" }), store, chat: null }), store };
}

describe("parseGraderInfo", () => {
  it("turns Score N lines into bands of one criterion, highest first", () => {
    const r = parseGraderInfo({ title: "Q1 – Comparing countries (E8.1.W1)", text: "", maxMark: 10, graderInfo: GRADER_INFO });
    expect(r.criteria).toHaveLength(1);
    const c = r.criteria[0]!;
    expect(c.title).toBe("Q1 – Comparing countries");
    expect(c.maxPoints).toBe(10);
    expect(c.bands.map((b) => b.points)).toEqual([10, 5, 0]);
    expect(c.bands[0]!.descriptor).toMatch(/^Accurately compares both features/);
    expect(c.bands[0]!.descriptor).not.toMatch(/Examples/);
    expect(c.concepts.length).toBeGreaterThan(0);
  });

  it("falls back to full/partial/none when the notes have no scores", () => {
    const r = parseGraderInfo({ title: "Q", text: "", maxMark: 12, graderInfo: "Mark holistically." });
    expect(r.criteria[0]!.bands.map((b) => b.points)).toEqual([12, 6, 0]);
  });
});

describe("parseExampleAnchors", () => {
  it("turns each worked example into an anchor labelled with its score", () => {
    const anchors = parseExampleAnchors(GRADER_INFO);
    expect(anchors).toEqual([
      { label: "Example earning 10", text: "New Zealand is hotter than Canada." },
      { label: "Example earning 5", text: "New Zealand is hotter than Canada." },
      { label: "Example earning 0", text: "Canada colder than New Zealand." },
    ]);
    expect(parseExampleAnchors("Score 10: perfect. Score 0: blank.")).toEqual([]);
  });
});

describe("POST /lms/moodle/page", () => {
  it("creates course, assignment, question with a drafted rubric, students and answers on first sight", async () => {
    const { app, store } = mkApp();
    const res = await app.request("/lms/moodle/page", { method: "POST", headers: hdr(T1), body: JSON.stringify(page()) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rubricDrafted).toBe(true);
    expect(body.rubricSource).toBe("parsed");
    expect(Object.keys(body.answers)).toEqual(["78:1", "59:1"]);

    const a = store.assignment(T1, body.assignmentId)!;
    expect(a.lmsAssignmentId).toBe(moodleIds.quiz("157"));
    expect(a.title).toBe("Unit 1–2 Assessment");
    expect(store.course(T1, a.courseId)?.lmsCourseId).toBe(moodleIds.course("17"));
    expect(a.questions).toHaveLength(1);
    expect(a.questions[0]).toMatchObject({ lmsQuestionId: moodleIds.question("172"), totalPoints: 10, index: 1 });
    expect(a.questions[0]!.rubric.criteria[0]!.bands.map((b) => b.points)).toEqual([10, 5, 0]);
    expect(a.questions[0]!.anchors).toHaveLength(3);

    const answers = store.answersFor(a.id);
    expect(answers.map((x) => [x.studentName, x.studentIndex])).toEqual([["Fatma Kaya", 1], ["Zeynep Kara", 2]]);
    expect(store.studentByLmsId(moodleIds.student("fatma.kaya@example.com", ""))?.name).toBe("Fatma Kaya");
  });

  it("is idempotent: a second sync keeps ids and does not redraft the rubric", async () => {
    const { app, store } = mkApp();
    const first = await (await app.request("/lms/moodle/page", { method: "POST", headers: hdr(T1), body: JSON.stringify(page()) })).json();
    // Teacher edits the rubric in the web app between page loads.
    const a = store.assignment(T1, first.assignmentId)!;
    const edited = { ...a.questions[0]!, rubric: { ...a.questions[0]!.rubric, criteria: a.questions[0]!.rubric.criteria.map((c) => ({ ...c, concepts: ["weather_comparison", "population_comparison", "grammar"] })) } };
    const { id, teacherId: _t, ...rest } = a;
    store.updateAssignment(T1, id, { ...rest, questions: [edited] });

    const second = await (await app.request("/lms/moodle/page", { method: "POST", headers: hdr(T1), body: JSON.stringify(page({ attempts: [page().attempts[0]!, { lmsId: "80:1", attemptNumber: 1, studentName: "Ali Demir", studentEmail: "ali.demir@example.com", text: "New Zealand is hotter." }] })) })).json();
    expect(second.assignmentId).toBe(first.assignmentId);
    expect(second.questionId).toBe(first.questionId);
    expect(second.rubricDrafted).toBe(false);
    expect(second.answers["78:1"]).toEqual(first.answers["78:1"]);
    expect(store.assignment(T1, first.assignmentId)!.questions[0]!.rubric.criteria[0]!.concepts).toContain("weather_comparison");
    // The question text follows the page; the rubric stays as the teacher left it.
    const refreshed = await (await app.request("/lms/moodle/page", { method: "POST", headers: hdr(T1), body: JSON.stringify(page({ question: { ...page().question, text: "Country | Weather\nNew Zealand | 45 °C" } })) })).json();
    expect(refreshed.question.prompt).toBe("Country | Weather\nNew Zealand | 45 °C");
    expect(store.assignment(T1, first.assignmentId)!.questions[0]!.rubric.criteria[0]!.concepts).toContain("weather_comparison");
    expect(store.answersFor(first.assignmentId).map((x) => [x.studentName, x.studentIndex])).toEqual([["Fatma Kaya", 1], ["Zeynep Kara", 2], ["Ali Demir", 3]]);
  });

  it("adds a second question to the same quiz and keeps roster positions across questions", async () => {
    const { app, store } = mkApp();
    const first = await (await app.request("/lms/moodle/page", { method: "POST", headers: hdr(T1), body: JSON.stringify(page()) })).json();
    const q4 = page({ question: { lmsId: "175", slot: 4, title: "Q4 – Kevin's excuse", text: "Why did Kevin refuse?", maxMark: 10, graderInfo: "Score 10: full. Score 0: none." }, attempts: [{ lmsId: "59:4", attemptNumber: 1, studentName: "Zeynep Kara", studentEmail: "zeynep.kara2@example.com", text: "He was busy." }] });
    const second = await (await app.request("/lms/moodle/page", { method: "POST", headers: hdr(T1), body: JSON.stringify(q4) })).json();
    expect(second.assignmentId).toBe(first.assignmentId);
    expect(second.questionId).not.toBe(first.questionId);
    const a = store.assignment(T1, first.assignmentId)!;
    expect(a.questions.map((q) => q.index)).toEqual([1, 2]);
    const zeynepQ4 = store.answer(a.id, second.answers["59:4"].answerId)!;
    expect(zeynepQ4.studentIndex).toBe(2);
    expect(second.answers["59:4"].studentIndex).toBe(2);
  });

  it("analyzes a synced answer against the drafted rubric and scopes everything to the teacher", async () => {
    const { app } = mkApp();
    const synced = await (await app.request("/lms/moodle/page", { method: "POST", headers: hdr(T1), body: JSON.stringify(page()) })).json();
    const res = await app.request("/analyze", { method: "POST", headers: hdr(T1), body: JSON.stringify({ assignmentId: synced.assignmentId, questionId: synced.questionId, answerId: synced.answers["78:1"].answerId }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.maxTotal).toBe(10);
    expect(body.criteria).toHaveLength(1);
    expect(typeof body.suggestedTotal).toBe("number");

    const other = await app.request(`/assignments/${synced.assignmentId}`, { headers: hdr("t-second") });
    expect(other.status).toBe(404);
    const bad = await app.request("/lms/moodle/page", { method: "POST", headers: hdr(T1), body: JSON.stringify({ lms: "canvas" }) });
    expect(bad.status).toBe(400);
  });
});
