import { LmsError, type LmsAdapter } from "./adapter";

export interface CanvasAdapterOptions {
  /** e.g. https://school.instructure.com/api/v1 */
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
}

/**
 * Not implemented yet. Pointing Ghost Grader at a real Canvas instance means
 * filling in these three methods and nothing else; the rest of the system only
 * talks to the LmsAdapter interface. The Canvas REST endpoints that map onto it:
 *
 *   listAssignments  GET  /courses/:course_id/assignments
 *   pullAssignment   GET  /courses/:course_id/assignments/:id
 *                    GET  /courses/:course_id/quizzes/:quiz_id/questions
 *                    GET  /courses/:course_id/assignments/:id/submissions?include[]=submission_history
 *   pushGrades       POST /courses/:course_id/assignments/:id/submissions/update_grades
 *
 * Canvas has no per-request idempotency key, so pushGrades must read current
 * grades first and skip those already equal to the pushed points.
 */
export function createCanvasAdapter(_opts: CanvasAdapterOptions): LmsAdapter {
  const notYet = async (): Promise<never> => {
    throw new LmsError("The Canvas adapter is not implemented yet.", false);
  };
  return {
    name: "canvas",
    listAssignments: notYet,
    pullAssignment: notYet,
    pushGrades: notYet,
  };
}
