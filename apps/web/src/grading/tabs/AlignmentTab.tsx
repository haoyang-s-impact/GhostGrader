import type { AnalysisResult, Question } from "@gg/shared";
import type { GradingTarget } from "../decisions";

export type AnalysisState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; result: AnalysisResult }
  | { status: "error"; message: string; retryable: boolean };

interface Props {
  target: GradingTarget | null;
  question: Question | null;
  /** The draft grade in the form. */
  grade: number | null;
  analysis: AnalysisState;
  inserted: boolean;
  onRetry: () => void;
  onInsert: () => void;
  onApplyGrade: () => void;
}

export function AlignmentTab({ target, question, grade, analysis, inserted, onRetry, onInsert, onApplyGrade }: Props) {
  if (!target) return <div className="gg-status">Pick a student to start grading.</div>;
  const titleOf = (id: string) => question?.rubric.criteria.find((c) => c.id === id)?.title ?? humanize(id);

  return (
    <>
      <div className="gg-student">
        Reviewing <strong>{target.answer.studentName}</strong> · student #{target.answer.studentIndex}
      </div>

      {analysis.status === "loading" && (
        <div className="gg-status" data-gg-state="loading">
          <div className="gg-spinner" />
          Reading the answer against this question's rubric…
        </div>
      )}

      {analysis.status === "error" && (
        <div className="gg-card" data-gg-state="error">
          <div className="gg-error">{analysis.message}</div>
          <div className="gg-row" style={{ marginTop: 8 }}>
            <button className="gg-btn" onClick={onRetry}>Retry</button>
            <span className="gg-none">Manual grading is unaffected.</span>
          </div>
        </div>
      )}

      {analysis.status === "ready" && (
        <div data-gg-state="ready">
          <div className="gg-suggest" data-gg-suggested={analysis.result.suggestedTotal}>
            <div className="gg-suggest-label">
              Rubric-referenced grade{analysis.result.provider && <span className="gg-via" data-gg-provider={analysis.result.provider}> · via {analysis.result.provider}</span>}
            </div>
            <div className="gg-suggest-n">
              {analysis.result.suggestedTotal}
              <span className="gg-suggest-max">/ {analysis.result.maxTotal}</span>
            </div>
            <p className="gg-suggest-why" data-gg-summary>{analysis.result.summary}</p>
            <div className="gg-row">
              <button className="gg-btn gg-btn-primary" onClick={onApplyGrade} data-gg-apply-grade>
                Use {analysis.result.suggestedTotal}
              </button>
              <span className="gg-none">{grade === null ? "No grade entered yet." : `You entered ${grade}.`}</span>
            </div>
          </div>

          <div className="gg-section-title">Why, by criterion</div>
          {analysis.result.criteria.map((c) => (
            <div className="gg-card" key={c.criterionId} data-gg-criterion-card={c.criterionId}>
              <div className="gg-card-head">
                <span className="gg-crit-title">{titleOf(c.criterionId)}</span>
                <span className={`gg-level ${c.level}`} data-gg-suggested={c.suggestedPoints}>
                  {c.level} · {c.suggestedPoints}
                </span>
              </div>
              {c.evidence.length > 0 ? (
                <ul className="gg-evidence">
                  {c.evidence.map((q) => (
                    <li key={q}>“{q}”</li>
                  ))}
                </ul>
              ) : (
                <div className="gg-none">No supporting evidence found in the response.</div>
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
            <h4>Feedback draft</h4>
            <p data-gg-feedback-draft>{analysis.result.feedbackDraft}</p>
            <div className="gg-row">
              <button className="gg-btn" onClick={onInsert} data-gg-insert>
                {inserted ? "Inserted ✓" : "Use as feedback"}
              </button>
              <span className="gg-none">You can edit it before submitting.</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function humanize(id: string) {
  return id.replace(/_/g, " ").replace(/^\w/, (ch) => ch.toUpperCase());
}
