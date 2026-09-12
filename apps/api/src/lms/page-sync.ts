import { z } from "zod";
import type { Answer, Assignment, Question } from "@gg/shared";
import { draftRubric, parseExampleAnchors } from "../rubric-draft";
import type { JsonChat } from "../openrouter";
import { newId, type Store } from "../store";

/**
 * What the extension reads off a Moodle quiz manual-grading page. No Moodle
 * credentials are involved: the teacher is already looking at this data, and
 * the extension forwards it so the API can hold rubric, answers and decisions
 * in one place. Ids are namespaced so a later web-services adapter can find
 * the same rows.
 */
export const MoodlePageBody = z.object({
  lms: z.literal("moodle"),
  course: z.object({ lmsId: z.string().min(1), name: z.string().min(1) }),
  quiz: z.object({ lmsId: z.string().min(1), name: z.string().min(1) }),
  question: z.object({
    lmsId: z.string().min(1),
    slot: z.number().int().positive(),
    title: z.string().min(1),
    text: z.string().default(""),
    maxMark: z.number().positive(),
    graderInfo: z.string().default(""),
  }),
  attempts: z
    .array(
      z.object({
        /** Question-usage id plus slot, e.g. "78:1". Stable for the attempt. */
        lmsId: z.string().min(1),
        attemptNumber: z.number().int().positive().default(1),
        studentName: z.string().min(1),
        studentEmail: z.string().default(""),
        text: z.string().default(""),
      }),
    )
    .max(200),
});
export type MoodlePageInput = z.infer<typeof MoodlePageBody>;

export interface PageSyncResult {
  assignmentId: string;
  questionId: string;
  question: Question;
  rubricDrafted: boolean;
  rubricSource: "model" | "parsed" | null;
  /** attempt lmsId -> the stored answer's ids, what a Decision needs. */
  answers: Record<string, { answerId: string; studentId: string; studentIndex: number }>;
}

export const moodleIds = {
  course: (id: string) => `moodle:course:${id}`,
  quiz: (id: string) => `moodle:quiz:${id}`,
  question: (id: string) => `moodle:q:${id}`,
  attempt: (id: string) => `moodle:quba:${id}`,
  student: (email: string, name: string) => (email ? `moodle:user:${email.toLowerCase()}` : `moodle:name:${name.toLowerCase()}`),
};

export async function syncGradingPage(store: Store, teacherId: string, input: MoodlePageInput, chat: JsonChat | null, log?: (m: string) => void): Promise<PageSyncResult> {
  const now = Date.now();
  const course = store.courseByLmsId(teacherId, moodleIds.course(input.course.lmsId)) ?? store.createCourse(teacherId, input.course.name, "", moodleIds.course(input.course.lmsId));

  let assignment = store.assignmentByLmsId(teacherId, moodleIds.quiz(input.quiz.lmsId));
  let question = assignment?.questions.find((q) => q.lmsQuestionId === moodleIds.question(input.question.lmsId));
  let rubricSource: PageSyncResult["rubricSource"] = null;

  if (!question) {
    const draft = await draftRubric({ title: input.question.title, text: input.question.text, maxMark: input.question.maxMark, graderInfo: input.question.graderInfo }, chat, log);
    rubricSource = draft.source;
    question = {
      id: newId("q"),
      index: (assignment?.questions.length ?? 0) + 1,
      title: input.question.title,
      prompt: input.question.text,
      rubric: draft.rubric,
      anchors: parseExampleAnchors(input.question.graderInfo),
      totalPoints: input.question.maxMark,
      lmsQuestionId: moodleIds.question(input.question.lmsId),
    };
    if (!assignment) {
      assignment = store.createAssignment({
        id: newId("a"),
        teacherId,
        courseId: course.id,
        title: input.quiz.name,
        course: course.name,
        learningObjectives: [],
        questions: [question],
        updatedAt: now,
        lmsAssignmentId: moodleIds.quiz(input.quiz.lmsId),
        lastPulledAt: now,
      });
    } else {
      const { id, teacherId: _t, ...rest } = assignment;
      assignment = store.updateAssignment(teacherId, id, { ...rest, questions: [...assignment.questions, question], updatedAt: now, lastPulledAt: now })!;
    }
  } else if (assignment && question) {
    // The question text is LMS-owned and follows the page; the rubric is
    // teacher-owned and never touched here. Anchors are filled from the grader
    // notes only while the teacher has not written any.
    const anchors = question.anchors.length ? question.anchors : parseExampleAnchors(input.question.graderInfo);
    const changed = question.prompt !== input.question.text || anchors !== question.anchors;
    const refreshed: Question = { ...question, prompt: input.question.text, anchors };
    const { id, teacherId: _t, ...rest } = assignment;
    assignment = store.updateAssignment(teacherId, id, {
      ...rest,
      questions: assignment.questions.map((q) => (q.id === refreshed.id ? refreshed : q)),
      updatedAt: changed ? now : rest.updatedAt,
      lastPulledAt: now,
    })!;
    question = refreshed;
  }
  const a: Assignment = assignment!;

  // Roster positions are stable per student within the assignment across questions.
  const existing = store.answersFor(a.id);
  const indexByStudent = new Map<string, number>();
  for (const x of existing) indexByStudent.set(x.studentId, x.studentIndex);
  let nextIndex = Math.max(0, ...existing.map((x) => x.studentIndex)) + 1;

  const answers: PageSyncResult["answers"] = {};
  for (const at of input.attempts) {
    const lmsStudentId = moodleIds.student(at.studentEmail, at.studentName);
    const student = store.studentByLmsId(lmsStudentId) ?? store.upsertStudent({ id: newId("stu"), name: at.studentName, lmsStudentId });
    if (student.name !== at.studentName) store.upsertStudent({ ...student, name: at.studentName });
    let studentIndex = indexByStudent.get(student.id);
    if (studentIndex === undefined) {
      studentIndex = nextIndex++;
      indexByStudent.set(student.id, studentIndex);
    }
    const prior = store.answerByLmsId(a.id, moodleIds.attempt(at.lmsId));
    const answer: Answer = {
      id: prior?.id ?? newId("ans"),
      assignmentId: a.id,
      questionId: question.id,
      studentId: student.id,
      studentName: at.studentName,
      studentIndex,
      text: at.text,
      lmsAnswerId: moodleIds.attempt(at.lmsId),
      submittedAt: prior?.submittedAt ?? now,
      pulledAt: now,
    };
    store.upsertAnswer(answer);
    answers[at.lmsId] = { answerId: answer.id, studentId: student.id, studentIndex };
  }

  return { assignmentId: a.id, questionId: question.id, question, rubricDrafted: rubricSource !== null, rubricSource, answers };
}
