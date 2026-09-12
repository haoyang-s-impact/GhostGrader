import type { AnalysisResult } from "@gg/shared";
import type { PageSubmission } from "../selectors";

export type AnalysisState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; result: AnalysisResult }
  | { status: "error"; message: string; retryable: boolean };

interface Props {
  page: PageSubmission | null;
  analysis: AnalysisState;
  inserted: boolean;
  onRetry: () => void;
  onInsert: () => void;
}

export function AlignmentTab({ page, analysis, inserted, onRetry, onInsert }: Props) {
  if (!page) return <div className="gg-status">Waiting for a submission to open…</div>;

  return (
    <>
      <div className="gg-student">
        Reviewing <strong>{page.studentName}</strong> · submission #{page.submissionIndex}
      </div>

      {analysis.status === "loading" && (
        <div className="gg-status" data-gg-state="loading">
          <div className="gg-spinner" />
          Aligning response with the rubric…
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
          {analysis.result.criteria.map((c) => {
            const row = page.rubric.find((r) => r.criterionId === c.criterionId);
            return (
              <div className="gg-card" key={c.criterionId} data-gg-criterion-card={c.criterionId}>
                <div className="gg-card-head">
                  <span className="gg-crit-title">{row?.title ?? c.criterionId}</span>
                  <span className={`gg-level ${c.level}`} data-gg-suggested={c.suggestedPoints}>
                    {c.level} · {c.suggestedPoints}/{row?.maxPoints ?? "?"}
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
            );
          })}

          <div className="gg-feedback">
            <h4>Feedback draft</h4>
            <p data-gg-feedback-draft>{analysis.result.feedbackDraft}</p>
            <div className="gg-row">
              <button className="gg-btn gg-btn-primary" onClick={onInsert} data-gg-insert>
                {inserted ? "Inserted ✓" : "Insert into comment"}
              </button>
              <span className="gg-none">You can edit it before submitting.</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
