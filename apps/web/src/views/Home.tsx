import { useEffect, useState } from "react";
import { assignmentMax, type Answer, type Assignment, type Course } from "@gg/shared";
import { api } from "../api";
import { href } from "../router";

export function HomeView() {
  const [data, setData] = useState<{ courses: Course[]; assignments: Assignment[]; answers: Record<string, Answer[]> } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [courses, assignments] = await Promise.all([api.courses(), api.assignments()]);
      const answers = Object.fromEntries(await Promise.all(assignments.map(async (a) => [a.id, await api.answers(a.id)] as const)));
      setData({ courses, assignments, answers });
    })().catch((e) => setError(e instanceof Error ? e.message : "Could not load courses."));
  }, []);

  if (error) return <main className="app-page"><div className="app-error">{error}</div></main>;
  if (!data) return <main className="app-page app-muted">Loading…</main>;

  return (
    <main className="app-page">
      <h1>Courses</h1>
      <p className="app-muted">Each assignment holds questions and the students' answers to them. Ghost Grader checks every grade you give against that question's rubric and against the grades you gave other students.</p>
      {data.courses.map((c) => {
        const as = data.assignments.filter((a) => a.courseId === c.id);
        return (
          <section className="app-card" key={c.id} data-course-id={c.id}>
            <div className="app-row">
              <h2 style={{ margin: 0 }}>{c.name}</h2>
              <span className="app-muted">{c.term}</span>
            </div>
            <ul className="app-list" style={{ marginTop: 8 }}>
              {as.length === 0 && <li className="app-muted">No assignments yet.</li>}
              {as.map((a) => {
                const answers = data.answers[a.id] ?? [];
                const first = a.questions[0];
                return (
                  <li key={a.id} data-assignment={a.id}>
                    <div>
                      <strong>{a.title}</strong>
                      <div className="app-muted">
                        {a.questions.length} question{a.questions.length === 1 ? "" : "s"} · {assignmentMax(a)} pts · {answers.length} answers
                      </div>
                    </div>
                    <span className="app-spacer" />
                    <a className="app-btn app-btn-sm" href={href("rubric", a.id)}>Rubrics</a>
                    <a className="app-btn app-btn-sm" href={href("grades", a.id)}>Grades</a>
                    {first && (
                      <a className="app-btn app-btn-sm app-btn-primary" href={href("grade", a.id, first.id)} data-start-grading>
                        Grade
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
            <a className="app-btn app-btn-sm" href={href("rubric", "new", c.id)} style={{ marginTop: 8 }}>
              + New assignment
            </a>
          </section>
        );
      })}
    </main>
  );
}
