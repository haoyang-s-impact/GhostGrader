import { useEffect, useMemo, useRef, useState } from "react";
import { questionById, questionMax, type Answer, type Assignment } from "@gg/shared";
import { api, type SyncStatus } from "../api";
import { go, href } from "../router";
import { latestByAnswer, type GradingTarget } from "../grading/decisions";
import { AlignmentTab } from "../grading/tabs/AlignmentTab";
import { ConsistencyTab } from "../grading/tabs/ConsistencyTab";
import { SessionTab } from "../grading/tabs/SessionTab";
import { useGrading, type Tab } from "../grading/useGrading";

interface Props {
  assignmentId: string;
  questionId: string;
  answerId?: string;
}

export function GradeView({ assignmentId, questionId, answerId }: Props) {
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.assignment(assignmentId), api.answers(assignmentId)]).then(
      ([a, ans]) => {
        setAssignment(a);
        setAnswers(ans);
      },
      (e) => setError(e instanceof Error ? e.message : "Could not load the assignment."),
    );
  }, [assignmentId]);

  const question = assignment ? questionById(assignment, questionId) ?? null : null;
  const questionAnswers = useMemo(() => answers.filter((a) => a.questionId === questionId), [answers, questionId]);
  const answer = questionAnswers.find((a) => a.id === answerId) ?? null;

  // Open the first student when no answer (or an answer from another question) is in the URL.
  useEffect(() => {
    if (!assignment || !question) return;
    if (!answer && questionAnswers[0]) go("grade", assignmentId, questionId, questionAnswers[0].id);
  }, [assignment, question, answer, questionAnswers, assignmentId, questionId]);

  const target: GradingTarget | null = useMemo(
    () => (question && answer ? { assignmentId, questionId: question.id, answer, maxPoints: questionMax(question) } : null),
    [assignmentId, question, answer],
  );

  const [grade, setGrade] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  // Set once the teacher (or a Ghost Grader action like Align) edits the form for this
  // answer, so a later session refresh never overwrites an unsubmitted draft.
  const touched = useRef(false);
  const g = useGrading(target, {
    grade,
    setGrade: (n) => {
      touched.current = true;
      setGrade(n);
    },
    comment,
    setComment: (s) => {
      touched.current = true;
      setComment(s);
    },
  });

  // Reopening a student shows the grade and feedback already submitted for them.
  const latest = useMemo(() => latestByAnswer(g.decisions), [g.decisions]);
  useEffect(() => {
    touched.current = false;
    const d = answer ? latest.get(answer.id) : undefined;
    setGrade(d ? d.points : null);
    setComment(d ? d.comment : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answer?.id]);
  useEffect(() => {
    if (touched.current || !answer) return;
    const d = latest.get(answer.id);
    if (d) {
      setGrade(d.points);
      setComment(d.comment);
    }
  }, [latest, answer]);

  if (error) return <main className="app-page"><div className="app-error">{error}</div></main>;
  if (!assignment) return <main className="app-page app-muted">Loading…</main>;
  if (!question) return <main className="app-page"><div className="app-error">This assignment has no question {questionId}.</div></main>;

  const idx = questionAnswers.findIndex((a) => a.id === answer?.id);
  const next = idx >= 0 ? questionAnswers[idx + 1] : undefined;
  const graded = questionAnswers.filter((a) => latest.has(a.id)).length;
  const modeLabel = g.mode === "mock" ? "Mock mode" : g.mode === "offline" ? "Offline" : g.mode === "unknown" ? "…" : (g.health?.model?.split("/").pop() ?? g.mode);

  return (
    <div className="ws">
      <aside className="ws-col">
        <div className="ws-label">{assignment.title}</div>
        <nav className="ws-questions">
          {assignment.questions.map((q) => (
            <a key={q.id} href={href("grade", assignmentId, q.id)} className={`ws-qtab ${q.id === questionId ? "is-active" : ""}`} data-question-tab={q.id}>
              Q{q.index}
            </a>
          ))}
        </nav>
        <div className="app-muted ws-progress" data-progress>
          {graded} of {questionAnswers.length} graded
        </div>
        <ul className="ws-students">
          {questionAnswers.map((a) => {
            const d = latest.get(a.id);
            return (
              <li key={a.id}>
                <a href={href("grade", assignmentId, questionId, a.id)} className={a.id === answer?.id ? "is-active" : ""} data-student-link={a.id}>
                  <span className="ws-idx">#{a.studentIndex}</span>
                  <span>{a.studentName}</span>
                  {d && <span className="ws-points">{d.points}</span>}
                </a>
              </li>
            );
          })}
          {questionAnswers.length === 0 && <li className="app-muted" style={{ padding: 12 }}>No answers to this question yet.</li>}
        </ul>
        {g.health?.lms && <SyncBar assignmentId={assignmentId} />}
      </aside>

      <main className="ws-col">
        <section className="app-card">
          <div className="ws-label">
            Question {question.index}{question.title ? `: ${question.title}` : ""} · {questionMax(question)} pts
          </div>
          <p className="ws-prompt">{question.prompt}</p>
          {answer ? (
            <>
              <div className="ws-student">
                <div className="ws-avatar">{answer.studentName.charAt(0)}</div>
                <div>
                  <div className="ws-name" data-student-name>{answer.studentName}</div>
                  <div className="app-muted">Student #{answer.studentIndex} · {idx + 1} of {questionAnswers.length}</div>
                </div>
              </div>
              <div className="ws-label">Answer</div>
              <p className="ws-answer" data-answer-text>{answer.text}</p>
            </>
          ) : (
            <p className="app-muted">Pick a student.</p>
          )}
        </section>

        {answer && (
          <section className="app-card">
            <div className="ws-label">Grade</div>
            <div className="ws-grade-row">
              <input
                className="ws-grade"
                type="number"
                step="0.5"
                min={0}
                max={questionMax(question)}
                value={grade ?? ""}
                data-grade-input
                aria-label="Grade"
                onChange={(e) => {
                  touched.current = true;
                  const raw = e.target.value.trim();
                  setGrade(raw === "" || !Number.isFinite(Number(raw)) ? null : Number(raw));
                }}
              />
              <span className="ws-grade-max">/ {questionMax(question)}</span>
            </div>
            <div className="ws-label" style={{ marginTop: 14 }}>Feedback for the student</div>
            <textarea
              className="app-textarea"
              rows={5}
              value={comment}
              data-comment
              onChange={(e) => {
                touched.current = true;
                setComment(e.target.value);
              }}
            />
            <div className="app-row" style={{ marginTop: 10 }}>
              <button className="app-btn app-btn-primary" disabled={grade === null} onClick={() => void g.submit()} data-submit>
                Submit grade
              </button>
              {next && (
                <a className="app-btn" href={href("grade", assignmentId, questionId, next.id)} data-next>
                  Next student →
                </a>
              )}
              {g.unsubmitted ? (
                <span className="app-muted" data-unsubmitted>Not submitted yet</span>
              ) : g.submitted ? (
                <span className="ws-saved" data-saved>Submitted ✓</span>
              ) : null}
            </div>
          </section>
        )}
      </main>

      <aside className="ws-panel">
        <div className="gg-root" data-gg-panel data-gg-analysis={g.analysis.status}>
          <div className="gg-header">
            <div className="gg-ghost">👻</div>
            <div className="gg-title">Ghost Grader</div>
            <span className={`gg-chip ${g.mode === "mock" ? "is-mock" : g.mode === "offline" ? "is-offline" : ""}`} data-gg-mode={g.mode} title={g.health?.model}>
              {g.recording ? "recording…" : modeLabel}
            </span>
          </div>
          <div className="gg-tabs" role="tablist">
            <TabButton id="alignment" tab={g.tab} onOpen={g.openTab}>Grade</TabButton>
            <TabButton id="consistency" tab={g.tab} onOpen={g.openTab}>
              Checks{g.pending > 0 && <span className="gg-badge">{g.pending}</span>}
            </TabButton>
            <TabButton id="session" tab={g.tab} onOpen={g.openTab}>Session</TabButton>
          </div>
          <div className="gg-body">
            {g.tab === "alignment" && (
              <AlignmentTab target={target} question={question} grade={grade} analysis={g.analysis} inserted={g.inserted} onRetry={() => void g.retry()} onInsert={g.insertFeedback} onApplyGrade={g.applySuggestion} />
            )}
            {g.tab === "consistency" && (
              <ConsistencyTab unsubmitted={g.unsubmitted} alert={g.alert} check={g.check} history={g.alertHistory} onAlign={g.align} onKeep={g.keep} onApproveCheck={g.approveCheck} onDismissCheck={g.dismissCheck} />
            )}
            {g.tab === "session" && (
              <SessionTab
                decisions={g.decisions.filter((d) => d.questionId === questionId)}
                alertsRaised={g.stats.alertsRaised}
                alertsAligned={g.stats.alertsAligned}
                checksRaised={g.stats.checksRaised}
                checksApproved={g.stats.checksApproved}
                totalStudents={questionAnswers.length}
                maxPoints={questionMax(question)}
              />
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

function TabButton({ id, tab, onOpen, children }: { id: Tab; tab: Tab; onOpen: (t: Tab) => void; children: React.ReactNode }) {
  return (
    <button className={`gg-tab ${tab === id ? "is-active" : ""}`} onClick={() => onOpen(id)} role="tab" data-gg-tab={id}>
      {children}
    </button>
  );
}

/** Shown only when an LMS is configured: push graded answers back to it. */
function SyncBar({ assignmentId }: { assignmentId: string }) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => api.syncStatus(assignmentId).then(setStatus, () => undefined);
  useEffect(() => {
    void refresh();
    const t = window.setInterval(refresh, 5000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId]);
  if (!status?.linked) return null;
  return (
    <div className="app-card ws-sync">
      <div className="ws-label">LMS</div>
      <div className="app-muted">{status.pushed} pushed · {status.pending} pending{status.failed ? ` · ${status.failed} failed` : ""}</div>
      {error && <div className="app-error">{error}</div>}
      <button
        className="app-btn app-btn-sm"
        style={{ marginTop: 8 }}
        disabled={busy || status.pending === 0}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await api.push(assignmentId);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Push failed.");
          }
          setBusy(false);
          void refresh();
        }}
      >
        Push {status.pending} grade{status.pending === 1 ? "" : "s"} to LMS
      </button>
    </div>
  );
}
