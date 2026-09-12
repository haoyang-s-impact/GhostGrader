import assignmentJson from "../fixtures/assignment.json";
import submissionsJson from "../fixtures/submissions.json";
import groundTruthJson from "../fixtures/ground-truth.json";
import { AssignmentSchema, GroundTruthSchema, SubmissionSchema } from "./schemas";

export const assignment = AssignmentSchema.parse(assignmentJson);
export const submissions = submissionsJson.map((s) => SubmissionSchema.parse(s));
export const groundTruth = GroundTruthSchema.parse(groundTruthJson);

export function criterionById(id: string) {
  const c = assignment.rubric.criteria.find((x) => x.id === id);
  if (!c) throw new Error(`Unknown criterion ${id}`);
  return c;
}
