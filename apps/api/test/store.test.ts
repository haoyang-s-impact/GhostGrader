import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { answers, assignment, type Decision, type PushRecord } from "@gg/shared";
import { Store } from "../src/store";

const T1 = "t-demo";
const q1 = answers.filter((a) => a.questionId === "q-haber-1");
const ans = (i: number) => q1.find((a) => a.studentIndex === i)!;

function decision(index: number, points: number, at = index): Decision {
  const a = ans(index);
  return {
    id: `${a.id}:grade`,
    assignmentId: assignment.id,
    questionId: a.questionId,
    answerId: a.id,
    studentId: a.studentId,
    studentIndex: index,
    studentName: a.studentName,
    points,
    maxPoints: 30,
    suggestedPoints: 20.5,
    missingConcepts: ["reversibility"],
    comment: "",
    at,
  };
}

describe("Store (SQLite)", () => {
  it("seeds an empty database with two teachers, both questions and twenty answers, and persists through a file", () => {
    const path = join(mkdtempSync(join(tmpdir(), "gg-db-")), "t.sqlite");
    const s1 = new Store(path);
    expect(s1.teachers().map((t) => t.id)).toEqual(["t-demo", "t-second"]);
    expect(s1.assignment(T1, assignment.id)?.questions).toHaveLength(2);
    expect(s1.answersFor(assignment.id)).toHaveLength(20);
    expect(s1.answersFor(assignment.id, "q-haber-2")).toHaveLength(5);
    const course = s1.createCourse(T1, "Persisted", "Fall", "lms-42");
    s1.close();

    const s2 = new Store(path);
    expect(s2.course(T1, course.id)?.name).toBe("Persisted");
    expect(s2.courseByLmsId(T1, "lms-42")?.id).toBe(course.id);
    expect(s2.courseByLmsId(T1, "")).toBeUndefined();
    expect(s2.teachers()).toHaveLength(2); // not re-seeded
    s2.close();
  });

  it("round-trips an assignment's questions, rubric and LMS linkage", () => {
    const s = new Store();
    const a = s.assignment(T1, assignment.id)!;
    expect(a.questions[0]!.rubric.criteria).toHaveLength(6);
    s.updateAssignment(T1, a.id, { ...a, lmsAssignmentId: "lms-a1", lastPulledAt: 7, updatedAt: 5 });
    expect(s.assignment(T1, a.id)).toMatchObject({ lmsAssignmentId: "lms-a1", lastPulledAt: 7, updatedAt: 5 });
    expect(s.assignmentByLmsId(T1, "lms-a1")?.id).toBe(a.id);
    expect(s.assignmentByLmsId("t-second", "lms-a1")).toBeUndefined();
    expect(s.updateAssignment("t-second", a.id, a)).toBeUndefined();
  });

  it("upserts students and answers by id", () => {
    const s = new Store(undefined, { withAnswers: false });
    expect(s.answersFor(assignment.id)).toEqual([]);
    s.upsertStudent({ id: "stu-x", name: "Xena", lmsStudentId: "lms-x" });
    s.upsertStudent({ id: "stu-x", name: "Xena Renamed", lmsStudentId: "lms-x" });
    expect(s.student("stu-x")?.name).toBe("Xena Renamed");
    expect(s.studentByLmsId("lms-x")?.id).toBe("stu-x");
    const a = { ...ans(1), id: "ans-x", studentId: "stu-x", studentName: "Xena", lmsAnswerId: "lms-ans-x" };
    s.upsertAnswer(a);
    s.upsertAnswer({ ...a, text: "edited" });
    expect(s.answersFor(assignment.id)).toHaveLength(1);
    expect(s.answer(assignment.id, "ans-x")?.text).toBe("edited");
    expect(s.answerByLmsId(assignment.id, "lms-ans-x")?.id).toBe("ans-x");
  });

  it("saves a session atomically: decisions upserted and pruned, overrides replaced, stats kept", () => {
    const s = new Store();
    const session = s.session(assignment.id);
    session.decisions.push(decision(4, 24), decision(11, 16));
    session.overrides.push("a|b");
    session.alertsRaised = 1;
    session.checksRaisedFor = [ans(4).id];
    s.saveSession(assignment.id, session);

    let loaded = s.session(assignment.id);
    expect(loaded.decisions.map((d) => d.studentIndex)).toEqual([4, 11]);
    expect(loaded.overrides).toEqual(["a|b"]);
    expect(loaded).toMatchObject({ alertsRaised: 1, checksRaisedFor: [ans(4).id] });

    // Re-grade #4 (same id, replaced), drop #11, clear overrides.
    loaded.decisions = [decision(4, 22, 99)];
    loaded.overrides = [];
    s.saveSession(assignment.id, loaded);
    loaded = s.session(assignment.id);
    expect(loaded.decisions).toHaveLength(1);
    expect(loaded.decisions[0]).toMatchObject({ points: 22, at: 99 });
    expect(loaded.overrides).toEqual([]);

    s.resetSession(assignment.id);
    expect(s.session(assignment.id)).toMatchObject({ decisions: [], overrides: [], alertsRaised: 0 });
  });

  it("keeps push records per assignment in order and replaces them wholesale", () => {
    const s = new Store();
    const rec = (points: number, status: PushRecord["status"]): PushRecord => ({
      answerId: ans(1).id,
      questionId: "q-haber-1",
      studentId: ans(1).studentId,
      points,
      clientReferenceId: `ref-${points}`,
      status,
      lmsGradeId: "",
      pushedAt: 0,
      error: "",
    });
    s.savePushes(assignment.id, [rec(30, "pushed"), rec(28, "failed")]);
    expect(s.pushesFor(assignment.id).map((r) => [r.points, r.status])).toEqual([[30, "pushed"], [28, "failed"]]);
    s.savePushes(assignment.id, [rec(29, "pushed")]);
    expect(s.pushesFor(assignment.id)).toHaveLength(1);
    expect(s.pushesFor("other")).toEqual([]);
  });

  it("isolates teachers", () => {
    const s = new Store();
    expect(s.assignment("t-second", assignment.id)).toBeUndefined();
    expect(s.coursesFor("t-second").map((c) => c.id)).toEqual(["c-hist210"]);
  });
});
