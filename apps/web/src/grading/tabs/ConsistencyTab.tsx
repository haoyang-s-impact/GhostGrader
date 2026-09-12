import type { DriftAlert, ScoreCheck } from "@gg/shared";

interface Props {
  /** The grade in the form has not been committed with Submit yet. */
  unsubmitted: boolean;
  alert: DriftAlert | null;
  check: ScoreCheck | null;
  history: DriftAlert[];
  onAlign: (alert: DriftAlert) => void;
  onKeep: (alert: DriftAlert) => void;
  onApproveCheck: (check: ScoreCheck) => void;
  onDismissCheck: (check: ScoreCheck) => void;
}

function humanize(tag: string) {
  return tag.replace(/_/g, " ");
}

function signed(n: number) {
  return n > 0 ? `+${n}` : `${n}`;
}

export function ConsistencyTab({ unsubmitted, alert, check, history, onAlign, onKeep, onApproveCheck, onDismissCheck }: Props) {
  return (
    <>
      {unsubmitted && (
        <div className="gg-status gg-unsubmitted" data-gg-unsubmitted-note>
          This grade is not recorded until you click Submit.
        </div>
      )}
      {check && (
        <div className="gg-alert gg-check" data-gg-check>
          <h4>⚑ Rubric check</h4>
          <p>
            You gave <strong>{check.enteredPoints}</strong> of {check.maxPoints}. Referenced against this question's rubric, this answer earns{" "}
            <strong>{check.suggestedPoints}</strong>
            {check.missingConcepts.length > 0 && (
              <>
                {" "}because it is missing <strong>{check.missingConcepts.map(humanize).join(", ")}</strong>
              </>
            )}
            .
          </p>
          {check.summary && <p className="gg-band-desc">{check.summary}</p>}
          <div className="gg-compare">
            <div>
              <div className="gg-n">{check.enteredPoints}</div>
              <div className="gg-l">your grade</div>
            </div>
            <div>
              <div className="gg-n">{check.suggestedPoints}</div>
              <div className="gg-l">rubric-referenced</div>
            </div>
          </div>
          <ul className="gg-breakdown">
            {check.breakdown.map((b) => (
              <li key={b.criterionId}>
                <span>{humanize(b.criterionId)}</span>
                <span className={`gg-level ${b.level}`}>{b.level}</span>
                <span className="gg-bd-pts">{b.suggestedPoints}/{b.maxPoints}</span>
              </li>
            ))}
          </ul>
          <p>Apply the rubric-referenced grade and insert student-specific feedback?</p>
          <div className="gg-row">
            <button className="gg-btn gg-btn-primary" onClick={() => onApproveCheck(check)} data-gg-approve-check>
              Approve {check.suggestedPoints} + feedback
            </button>
            <button className="gg-btn" onClick={() => onDismissCheck(check)} data-gg-dismiss-check>
              Keep mine
            </button>
          </div>
        </div>
      )}

      {alert ? (
        <div className="gg-alert" data-gg-alert>
          <h4>⚠ Consistency alert</h4>
          <p>
            <strong>{alert.priorStudentName || `Student #${alert.priorStudentIndex}`}</strong> (#{alert.priorStudentIndex}) had the same gap on this question
            {alert.sharedConcepts.length > 0 && (
              <>
                , <strong>{alert.sharedConcepts.map(humanize).join(", ")}</strong>,
              </>
            )}{" "}
            and you graded them <strong>{alert.priorPoints}</strong> against a rubric-referenced {alert.priorSuggested} ({signed(alert.priorOffset)}). Here you
            entered <strong>{alert.currentPoints}</strong> against {alert.currentSuggested} ({signed(alert.currentOffset)}).
          </p>
          <div className="gg-compare">
            <div>
              <div className="gg-n">{alert.priorPoints}</div>
              <div className="gg-l">#{alert.priorStudentIndex} · {signed(alert.priorOffset)} vs rubric</div>
            </div>
            <div>
              <div className="gg-n">{alert.currentPoints}</div>
              <div className="gg-l">this student · {signed(alert.currentOffset)} vs rubric</div>
            </div>
          </div>
          <p>Treat this student the same way?</p>
          <div className="gg-row">
            <button className="gg-btn gg-btn-primary" onClick={() => onAlign(alert)} data-gg-align>
              Align to {alert.recommendedPoints}
            </button>
            <button className="gg-btn" onClick={() => onKeep(alert)} data-gg-keep>
              Keep mine
            </button>
          </div>
        </div>
      ) : (
        !check && (
          <div className="gg-status" data-gg-no-alert>
            No issues. Ghost Grader checks each grade against this question's rubric and against the grades you gave other students with the same gaps on the same question.
          </div>
        )
      )}

      {history.length > 0 && (
        <div className="gg-hist">
          <h4>Earlier alerts this session</h4>
          <ul>
            {history.map((h, i) => (
              <li key={`${h.currentDecisionId}-${i}`}>
                <span>
                  #{h.priorStudentIndex} vs #{h.currentStudentIndex} · {h.sharedConcepts.map(humanize).join(", ")}
                </span>
                <span>
                  {h.priorPoints} / {h.currentPoints}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
