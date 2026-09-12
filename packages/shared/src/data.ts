import assignmentJson from "../fixtures/assignment.json";
import submissionsJson from "../fixtures/submissions.json";
import answersQ2Json from "../fixtures/answers-q2.json";
import groundTruthJson from "../fixtures/ground-truth.json";
import { AnswerSchema, AssignmentSchema, GroundTruthSchema, StudentSchema, type Answer, type Criterion, type Student } from "./schemas";

/** The seeded demo assignment: two questions, each carrying its own rubric. */
export const assignment = AssignmentSchema.parse(assignmentJson);

const pad = (n: number) => String(n).padStart(2, "0");

/** Roster derived from the question 1 essays, in their original order. */
export const students: Student[] = submissionsJson.map((s) =>
  StudentSchema.parse({ id: `stu-${pad(s.index)}`, name: s.studentName, lmsStudentId: `stu-${pad(s.index)}` }),
);

/**
 * Every seeded answer. Question 1 answers keep the original ids `sub-01`..
 * `sub-15` on purpose: ground truth and the analysis regression fixtures are
 * keyed by them. Question 2 has five answers and no ground truth, which
 * exercises the heuristic analyzer and partial grade rollups.
 */
export const answers: Answer[] = [
  ...submissionsJson.map((s) =>
    AnswerSchema.parse({
      id: s.id,
      assignmentId: assignment.id,
      questionId: "q-haber-1",
      studentId: `stu-${pad(s.index)}`,
      studentName: s.studentName,
      studentIndex: s.index,
      text: s.text,
      lmsAnswerId: s.id,
    }),
  ),
  ...answersQ2Json.map((s) =>
    AnswerSchema.parse({
      id: s.id,
      assignmentId: assignment.id,
      questionId: "q-haber-2",
      studentId: `stu-${pad(s.studentIndex)}`,
      studentName: s.studentName,
      studentIndex: s.studentIndex,
      text: s.text,
      lmsAnswerId: s.id,
    }),
  ),
];

export const groundTruth = GroundTruthSchema.parse(groundTruthJson);

/** Find a criterion by id across every question of the seeded assignment. */
export function criterionById(id: string): Criterion {
  for (const q of assignment.questions) {
    const c = q.rubric.criteria.find((x) => x.id === id);
    if (c) return c;
  }
  throw new Error(`Unknown criterion ${id}`);
}
