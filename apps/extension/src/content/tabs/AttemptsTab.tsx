import type { AnalysisResult } from "@gg/shared";
import type { PageAttempt, PageContext } from "../moodle";

export type AnalysisState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; result: AnalysisResult }
  | { status: "error"; message: string };

interface Props {
  context: PageContext;
  attempts: PageAttempt[];
  analyses: Record<string, AnalysisState>;
  marks: Record<string, number | null>;
  selected: string | null;
  rubricNote: { drafted: boolean; source: "model" | "parsed" | null; editUrl: string } | null;
  syncError: string | null;
  onSelect: (lmsId: string) => void;
  onUse: (lmsId: string) => void;
  onInsertFeedback: (lmsId: string) => void;
  onRetry: (lmsId: string) => void;
  onRetrySync: () => void;
}

function humanize(tag: string) {
  return tag.replace(/_/g, " ");
}

export function AttemptsTab({ context, attempts, analyses, marks, selected, rubricNote, syncError, onSelect, onUse, onInsertFeedback, onRetry, onRetrySync }: Props) {
  const sel = selected ? attempts.find((a) => a.lmsId === selected) : undefined;
  const selState = sel ? analyses[sel.lmsId] : undefined;

  return (
    <>
      <div className="gg-context">
        <strong data-gg-question-title>{context.questionTitle}</strong> · out of {context.maxMark} · {attempts.length} on this page
        {context.attemptsTotal > 0 && <> · {context.attemptsTotal} to grade</>}
      </div>
      {syncError && (
        <div className="gg-card">
          <div className="gg-error">{syncError}</div>
          <button className="gg-btn gg-btn-sm" onClick={onRetrySync} style={{ marginTop: 6 }}>Retry</button>
        </div>
      )}
      {rubricNote && (
        <div className="gg-note" data-gg-rubric-note>
          {rubricNote.drafted
            ? `Rubric drafted from Moodle's "Information for graders"${rubricNote.source === "model" ? " by the model" : ""}. `
            : "Grading against this question's rubric. "}
          <a href={rubricNote.editUrl} target="_blank" rel="noreferrer">Edit rubric ↗</a>
        </div>
      )}

      <ul className="gg-list">
        {attempts.map((a) => {
          const st = analyses[a.lmsId] ?? { status: "idle" as const };
          const mark = marks[a.lmsId] ?? null;
          return (
            <li
              key={a.lmsId}
              className={`gg-attempt ${selected === a.lmsId ? "is-selected" : ""} ${st.status === "loading" ? "is-loading" : ""} ${st.status === "error" ? "is-error" : ""}`}
              data-gg-attempt={a.lmsId}
              onClick={() => onSelect(a.lmsId)}
            >
              <div>
                <div className="gg-name" data-gg-student>{a.studentName}</div>
                <div className="gg-sub">
                  {st.status === "ready" && st.result.missingConcepts.length > 0 ? `missing ${st.result.missingConcepts.slice(0, 2).map(humanize).join(", ")}` : st.status === "ready" ? "meets the rubric" : ""}
                </div>
                <div className="gg-mark-state">{mark === null ? "no mark yet" : `mark entered: ${mark}`}</div>
              </div>
              <div className="gg-sug" data-gg-suggested>
                {st.status === "ready" ? (
                  <>
                    {st.result.suggestedTotal} <small>/ {st.result.maxTotal}</small>
                  </>
                ) : st.status === "loading" ? (
                  "reading…"
                ) : st.status === "error" ? (
                  "failed"
                ) : (
                  "–"
                )}
              </div>
              {st.status === "ready" ? (
                <button
                  className="gg-btn gg-btn-sm gg-btn-primary"
                  data-gg-use
                  onClick={(e) => {
                    e.stopPropagation();
                    onUse(a.lmsId);
                  }}
                >
                  Use
                </button>
              ) : st.status === "error" ? (
                <button
                  className="gg-btn gg-btn-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRetry(a.lmsId);
                  }}
                >
                  Retry
                </button>
              ) : (
                <span />
              )}
            </li>
          );
        })}
      </ul>

      {sel && selState?.status === "ready" && (
        <div className="gg-detail" data-gg-detail>
          <h4>{sel.studentName}</h4>
          <div className="gg-suggest-n" data-gg-detail-suggested>
            {selState.result.suggestedTotal}
            <small>/ {selState.result.maxTotal}</small>
          </div>
          <p className="gg-why" data-gg-summary>{selState.result.summary}</p>
          {selState.result.criteria.map((c) => (
            <div className="gg-card" key={c.criterionId}>
              <div className="gg-card-head">
                <span className="gg-crit-title">{humanize(c.criterionId)}</span>
                <span className="gg-level">
                  {c.level} · {c.suggestedPoints}/{c.maxPoints}
                </span>
              </div>
              {c.evidence.length > 0 ? (
                <ul className="gg-evidence">
                  {c.evidence.slice(0, 2).map((q) => (
                    <li key={q}>“{q}”</li>
                  ))}
                </ul>
              ) : (
                <div className="gg-none">No supporting evidence in the answer.</div>
              )}
              {c.missingConcepts.length > 0 && (
                <div className="gg-missing">
                  {c.missingConcepts.map((t) => (
                    <span className="gg-tag" key={t}>missing: {t}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
          <div className="gg-feedback">
            <h5>Feedback draft</h5>
            <p data-gg-feedback-draft>{selState.result.feedbackDraft}</p>
            <div className="gg-row">
              <button className="gg-btn gg-btn-sm gg-btn-primary" onClick={() => onUse(sel.lmsId)} data-gg-detail-use>
                Use {selState.result.suggestedTotal} + feedback
              </button>
              <button className="gg-btn gg-btn-sm" onClick={() => onInsertFeedback(sel.lmsId)} data-gg-insert>
                Insert feedback only
              </button>
            </div>
          </div>
        </div>
      )}
      {sel && selState?.status === "error" && (
        <div className="gg-detail">
          <div className="gg-error">{selState.message}</div>
        </div>
      )}
    </>
  );
}
