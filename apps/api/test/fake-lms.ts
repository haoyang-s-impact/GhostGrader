import { answers, assignment, students } from "@gg/shared";
import { LmsError, type LmsAdapter, type PullResult, type PushGrade, type PushResult } from "../src/lms/adapter";

export interface FakeGrade {
  lmsGradeId: string;
  lmsQuestionId: string;
  lmsStudentId: string;
  points: number;
  comment: string;
  clientReferenceId: string;
}

/**
 * In-memory LMS for API tests: the seeded assignment and answers on the LMS
 * side, grades upserted per (question, student) the way a real gradebook holds
 * one grade per cell. No network, so tests exercise sync logic, not HTTP.
 */
export function fakeLms(opts: { failPush?: boolean; rejectRefs?: string[] } = {}) {
  const grades = new Map<string, FakeGrade>();
  const pushCalls: PushGrade[][] = [];
  let seq = 0;
  let answerOverrides: Record<string, string> = {};

  const pull = (): PullResult => ({
    course: { lmsId: "lms-c-chem101", name: assignment.course, term: "Fall 2026" },
    assignment: { lmsId: assignment.lmsAssignmentId, title: assignment.title, description: "" },
    questions: assignment.questions.map((q) => ({
      lmsId: q.lmsQuestionId,
      index: q.index,
      title: q.title,
      prompt: q.prompt,
      pointsPossible: q.rubric.criteria.reduce((acc, c) => acc + c.maxPoints, 0),
    })),
    answers: answers.map((a) => ({
      lmsId: a.lmsAnswerId,
      lmsQuestionId: assignment.questions.find((q) => q.id === a.questionId)!.lmsQuestionId,
      lmsStudentId: students.find((s) => s.id === a.studentId)!.lmsStudentId,
      studentName: a.studentName,
      text: answerOverrides[a.lmsAnswerId] ?? a.text,
      submittedAt: 1,
    })),
  });

  const adapter: LmsAdapter = {
    name: "mock",
    listAssignments: async () => [{ lmsId: assignment.lmsAssignmentId, courseName: assignment.course, title: assignment.title, questionCount: assignment.questions.length }],
    pullAssignment: async (id) => {
      if (id !== assignment.lmsAssignmentId) throw new LmsError(`mock-lms 404: no assignment ${id}`, false, 404);
      return pull();
    },
    pushGrades: async (_id, batch): Promise<PushResult> => {
      pushCalls.push(batch);
      if (opts.failPush) throw new LmsError("mock-lms 503: unavailable", true, 503);
      const result: PushResult = { accepted: [], rejected: [] };
      for (const g of batch) {
        if (opts.rejectRefs?.includes(g.clientReferenceId)) {
          result.rejected.push({ clientReferenceId: g.clientReferenceId, reason: "Student is not enrolled." });
          continue;
        }
        const cell = `${g.lmsQuestionId}|${g.lmsStudentId}`;
        const prior = grades.get(cell);
        const lmsGradeId = prior?.lmsGradeId ?? `grade-${++seq}`;
        grades.set(cell, { lmsGradeId, lmsQuestionId: g.lmsQuestionId, lmsStudentId: g.lmsStudentId, points: g.points, comment: g.comment ?? "", clientReferenceId: g.clientReferenceId });
        result.accepted.push({ clientReferenceId: g.clientReferenceId, lmsGradeId, gradedAt: 1000 + seq });
      }
      return result;
    },
  };

  return {
    adapter,
    grades,
    pushCalls,
    /** Simulate a student resubmitting in the LMS. */
    resubmit(lmsAnswerId: string, text: string) {
      answerOverrides = { ...answerOverrides, [lmsAnswerId]: text };
    },
  };
}
