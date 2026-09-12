import { useEffect, useState } from "react";
import type { Assignment, AssignmentGrade } from "@gg/shared";
import { api } from "../api";

/** Students × questions, with each student's grade rolled up across the assignment. */
export function GradebookView({ assignmentId }: { assignmentId: string }) {
  const [data, setData] = useState<{ assignment: Assignment; grades: AssignmentGrade[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.assignment(assignmentId), api.grades(assignmentId)]).then(
      ([assignment, grades]) => setData({ assignment, grades }),
      (e) => setError(e instanceof Error ? e.message : "Could not load grades."),
    );
  }, [assignmentId]);

  if (error) return <main className="app-page"><div className="app-error">{error}</div></main>;
  if (!data) return <main className="app-page app-muted">Loading…</main>;
  const { assignment, grades } = data;

  return (
    <main className="app-page">
      <h1>{assignment.title}: grades</h1>
      <p className="app-muted">Rolled up from the grades you submitted per question. Computed on read, so it always matches the latest grade.</p>
      <div className="app-card" style={{ overflowX: "auto", padding: 0 }}>
        <table className="gb" data-gradebook>
          <thead>
            <tr>
              <th>Student</th>
              {assignment.questions.map((q) => (
                <th key={q.id} className="num" title={q.prompt}>
                  Q{q.index} {q.title}
                </th>
              ))}
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {grades.map((g) => (
              <tr key={g.studentId} data-student={g.studentId}>
                <td>
                  <span className="app-muted">#{g.studentIndex}</span> {g.studentName}
                </td>
                {g.perQuestion.map((q) => (
                  <td key={q.questionId} className={`num ${q.points === null ? "na" : ""}`}>
                    {q.points === null ? "–" : `${q.points} / ${q.maxPoints}`}
                  </td>
                ))}
                <td className="num" data-total={g.studentId}>
                  <strong>{g.points}</strong> / {g.maxPoints}
                  {!g.complete && <div className="app-muted">{g.gradedQuestions} of {g.totalQuestions} graded</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
