import {
  decisionReference,
  latestPushes,
  pendingPush,
  questionById,
  syncSummary,
  type Answer,
  type Assignment,
  type PushRecord,
  type Question,
  type Rubric,
  type SyncSummary,
} from "@gg/shared";
import { LmsError, type LmsAdapter, type PushGrade } from "./lms/adapter";
import { newId, type Store } from "./store";

/** A request the caller got wrong, as opposed to the LMS failing. */
export class SyncError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404,
  ) {
    super(message);
  }
}

export interface PullSummary {
  assignment: Assignment;
  questions: { created: number; updated: number };
  answers: { created: number; updated: number; unchanged: number; skipped: number };
}

export interface PushSummary {
  pushed: PushRecord[];
  failed: PushRecord[];
  summary: SyncSummary;
}

/**
 * Placeholder for a question that arrives from the LMS without a rubric. The
 * LMS only knows what a question is worth; the analytic rubric is the
 * teacher's to write. One criterion on the question's scale keeps it gradeable
 * until they do.
 */
export function placeholderRubric(pointsPossible: number): Rubric {
  const max = pointsPossible > 0 ? pointsPossible : 10;
  const at = (f: number) => Math.round(max * f * 2) / 2;
  return {
    id: newId("rubric"),
    criteria: [
      {
        id: "overall",
        title: "Overall response",
        description: "Placeholder criterion created on import. Replace it with this question's real rubric.",
        maxPoints: max,
        bands: [
          { level: "Exemplary", points: max, descriptor: "Fully and accurately answers the question." },
          { level: "Proficient", points: at(0.7), descriptor: "Answers the question with minor gaps." },
          { level: "Developing", points: at(0.4), descriptor: "Partially answers the question." },
          { level: "Beginning", points: 0, descriptor: "Does not answer the question." },
        ],
        concepts: ["addresses_prompt"],
      },
    ],
  };
}

/** Moves question/answer pairs in from the LMS and grades back out to it. */
export class SyncService {
  constructor(
    private readonly store: Store,
    private readonly lms: LmsAdapter,
  ) {}

  listAvailable() {
    return this.lms.listAssignments();
  }

  /**
   * Idempotent pull. Upserts the course, assignment, questions, roster and
   * answers. Keyed on LMS ids, so pulling twice creates nothing new, a
   * resubmitted answer updates in place under the same local id (keeping its
   * grades attached), and rubrics already written for a question survive.
   */
  async pull(teacherId: string, lmsAssignmentId: string): Promise<PullSummary> {
    const pulled = await this.lms.pullAssignment(lmsAssignmentId);
    const now = Date.now();

    const course =
      this.store.courseByLmsId(teacherId, pulled.course.lmsId) ??
      this.store.createCourse(teacherId, pulled.course.name, pulled.course.term, pulled.course.lmsId);

    const existing = this.store.assignmentByLmsId(teacherId, pulled.assignment.lmsId);
    let createdQuestions = 0;
    let updatedQuestions = 0;
    const fromLms: Question[] = pulled.questions.map((pq) => {
      const prior = existing?.questions.find((q) => q.lmsQuestionId === pq.lmsId);
      if (!prior) {
        createdQuestions++;
        return { id: newId("q"), index: pq.index, title: pq.title, prompt: pq.prompt, rubric: placeholderRubric(pq.pointsPossible), anchors: [], lmsQuestionId: pq.lmsId };
      }
      const next = { ...prior, index: pq.index, title: pq.title || prior.title, prompt: pq.prompt };
      if (next.index !== prior.index || next.title !== prior.title || next.prompt !== prior.prompt) updatedQuestions++;
      return next;
    });
    // Questions no longer in the LMS keep their rubric and grades; they sort after the live ones.
    const orphans = (existing?.questions ?? []).filter((q) => !pulled.questions.some((pq) => pq.lmsId === q.lmsQuestionId));
    const questions = [...fromLms, ...orphans].map((q, i) => ({ ...q, index: i + 1 }));

    const promptsChanged = createdQuestions > 0 || updatedQuestions > 0 || orphans.length > 0;
    const assignment: Assignment = existing
      ? this.store.updateAssignment(teacherId, existing.id, {
          ...existing,
          title: pulled.assignment.title || existing.title,
          questions,
          lastPulledAt: now,
          // Only a real change invalidates the cached per-question prompts.
          updatedAt: promptsChanged ? now : existing.updatedAt,
        })!
      : this.store.createAssignment({
          id: newId("a"),
          teacherId,
          courseId: course.id,
          course: course.name,
          title: pulled.assignment.title,
          learningObjectives: [],
          questions,
          updatedAt: now,
          lmsAssignmentId: pulled.assignment.lmsId,
          lastPulledAt: now,
        });

    // Roster order is the LMS user id order, stable across questions and pulls.
    const roster = [...new Map(pulled.answers.map((a) => [a.lmsStudentId, a.studentName])).entries()].sort(([x], [y]) => x.localeCompare(y));
    const studentIndex = new Map(roster.map(([id], i) => [id, i + 1]));
    const studentIdFor = new Map<string, string>();
    for (const [lmsStudentId, name] of roster) {
      const prior = this.store.studentByLmsId(lmsStudentId);
      const student = this.store.upsertStudent({ id: prior?.id ?? lmsStudentId, name, lmsStudentId });
      studentIdFor.set(lmsStudentId, student.id);
    }

    const counts = { created: 0, updated: 0, unchanged: 0, skipped: 0 };
    for (const pa of pulled.answers) {
      const question = assignment.questions.find((q) => q.lmsQuestionId === pa.lmsQuestionId);
      if (!question) {
        counts.skipped++;
        continue;
      }
      const prior = this.store.answerByLmsId(assignment.id, pa.lmsId);
      const next: Answer = {
        // A new answer adopts the LMS id as its local id, so ids stay stable and readable across systems.
        id: prior?.id ?? pa.lmsId,
        assignmentId: assignment.id,
        questionId: question.id,
        studentId: studentIdFor.get(pa.lmsStudentId)!,
        studentName: pa.studentName,
        studentIndex: studentIndex.get(pa.lmsStudentId)!,
        text: pa.text,
        lmsAnswerId: pa.lmsId,
        submittedAt: pa.submittedAt,
        pulledAt: now,
      };
      if (!prior) counts.created++;
      else if (prior.text !== next.text || prior.questionId !== next.questionId || prior.studentName !== next.studentName) counts.updated++;
      else counts.unchanged++;
      this.store.upsertAnswer(next);
    }

    return { assignment, questions: { created: createdQuestions, updated: updatedQuestions }, answers: counts };
  }

  status(assignment: Assignment) {
    return {
      linked: assignment.lmsAssignmentId !== "",
      lmsAssignmentId: assignment.lmsAssignmentId,
      lastPulledAt: assignment.lastPulledAt,
      answers: this.store.answersFor(assignment.id).length,
      ...syncSummary(this.store.session(assignment.id).decisions, this.store.pushesFor(assignment.id)),
    };
  }

  /**
   * Push every grade the LMS does not already hold, optionally narrowed to some
   * answers. Always an explicit teacher action: nothing here runs on grade
   * submit. Idempotent, because each grade carries its content-addressed
   * reference and the LMS upserts on it.
   */
  async push(assignment: Assignment, answerIds?: string[]): Promise<PushSummary> {
    if (!assignment.lmsAssignmentId) throw new SyncError("This assignment is not linked to an LMS.", 400);
    const decisions = this.store.session(assignment.id).decisions;
    let pending = pendingPush(decisions, this.store.pushesFor(assignment.id));
    if (answerIds) pending = pending.filter((d) => answerIds.includes(d.answerId));

    const records = latestPushes(this.store.pushesFor(assignment.id));
    const pushed: PushRecord[] = [];
    const failed: PushRecord[] = [];
    const record = (r: PushRecord) => {
      records.set(r.answerId, r);
      (r.status === "pushed" ? pushed : failed).push(r);
    };
    const base = (d: (typeof pending)[number]): PushRecord => ({
      answerId: d.answerId,
      questionId: d.questionId,
      studentId: d.studentId,
      points: d.points,
      clientReferenceId: decisionReference(d),
      status: "pending",
      lmsGradeId: "",
      pushedAt: 0,
      error: "",
    });

    const grades: PushGrade[] = [];
    for (const d of pending) {
      const lmsQuestionId = questionById(assignment, d.questionId)?.lmsQuestionId ?? "";
      const lmsStudentId = this.store.student(d.studentId)?.lmsStudentId ?? "";
      if (!lmsQuestionId || !lmsStudentId) {
        record({ ...base(d), status: "failed", error: "This question or student has no LMS id, so there is nowhere to send the grade." });
        continue;
      }
      grades.push({ lmsQuestionId, lmsStudentId, points: d.points, comment: d.comment || undefined, clientReferenceId: decisionReference(d) });
    }

    if (grades.length > 0) {
      const byRef = new Map(pending.map((d) => [decisionReference(d), d]));
      try {
        const result = await this.lms.pushGrades(assignment.lmsAssignmentId, grades);
        for (const a of result.accepted) {
          const d = byRef.get(a.clientReferenceId);
          if (d) record({ ...base(d), status: "pushed", lmsGradeId: a.lmsGradeId, pushedAt: a.gradedAt || Date.now() });
        }
        for (const r of result.rejected) {
          const d = byRef.get(r.clientReferenceId);
          if (d) record({ ...base(d), status: "failed", error: r.reason });
        }
      } catch (err) {
        // The LMS call as a whole failed: mark every attempted grade and surface the error.
        const message = err instanceof Error ? err.message : String(err);
        for (const g of grades) {
          const d = byRef.get(g.clientReferenceId);
          if (d) record({ ...base(d), status: "failed", error: message });
        }
        this.store.savePushes(assignment.id, [...records.values()]);
        throw err instanceof LmsError ? err : new LmsError(message, true);
      }
    }

    this.store.savePushes(assignment.id, [...records.values()]);
    return { pushed, failed, summary: syncSummary(decisions, [...records.values()]) };
  }
}
