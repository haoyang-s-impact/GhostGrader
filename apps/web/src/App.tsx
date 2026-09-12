import { useEffect, useState, type ReactNode } from "react";
import type { Teacher } from "@gg/shared";
import { api, currentTeacherId, setCurrentTeacherId } from "./api";
import { GradebookView } from "./views/Gradebook";
import { GradeView } from "./views/Grade";
import { HomeView } from "./views/Home";
import { useHashRoute } from "./router";
import { RubricEditorView } from "./views/RubricEditor";

/**
 * Routes:
 *   #/                                          courses and assignments
 *   #/grade/:assignmentId/:questionId[/:answerId]  grading workspace
 *   #/grades/:assignmentId                      rolled-up grades per student
 *   #/rubric/:assignmentId                      edit questions and rubrics
 *   #/rubric/new/:courseId                      new assignment
 */
export function App() {
  const parts = useHashRoute();
  let page: ReactNode;
  let crumb: ReactNode = null;
  if (parts[0] === "grade" && parts[1] && parts[2]) {
    page = <GradeView key={parts[1]} assignmentId={parts[1]} questionId={parts[2]} answerId={parts[3]} />;
    crumb = "Grading";
  } else if (parts[0] === "grades" && parts[1]) {
    page = <GradebookView assignmentId={parts[1]} />;
    crumb = "Grades";
  } else if (parts[0] === "rubric" && parts[1] === "new" && parts[2]) {
    page = <RubricEditorView courseId={parts[2]} />;
    crumb = "New assignment";
  } else if (parts[0] === "rubric" && parts[1]) {
    page = <RubricEditorView key={parts[1]} assignmentId={parts[1]} />;
    crumb = "Rubrics";
  } else {
    page = <HomeView />;
  }
  return (
    <>
      <Header crumb={crumb} />
      {page}
    </>
  );
}

function Header({ crumb }: { crumb: ReactNode }) {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  useEffect(() => {
    api.teachers().then(setTeachers, () => setTeachers([]));
  }, []);
  return (
    <header className="app-header">
      <a className="app-brand" href="#/">
        <span className="app-logo">👻</span> Ghost Grader
      </a>
      {crumb && (
        <span className="app-crumb">
          <a href="#/">Courses</a> › {crumb}
        </span>
      )}
      <span className="app-spacer" />
      {teachers.length > 0 && (
        <label className="app-muted">
          Signed in as{" "}
          <select
            className="app-select"
            value={currentTeacherId()}
            data-teacher-switch
            onChange={(e) => {
              setCurrentTeacherId(e.target.value);
              location.hash = "#/";
              location.reload();
            }}
          >
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </header>
  );
}
