import type { DriftAlert, ScoreCheck } from "@gg/shared";
import type { PageSubmission } from "../selectors";

interface Props {
  page: PageSubmission | null;
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

export function ConsistencyTab({ page, alert, check, history, onAlign, onKeep, onApproveCheck, onDismissCheck }: Props) {
  const critTitle = (id: string) => page?.rubric.find((r) => r.criterionId === id)?.title ?? id;
  const critMax = (id: string) => page?.rubric.find((r) => r.criterionId === id)?.maxPoints ?? 0;

  return (
    <>
      {check && (
        <div className="gg-alert gg-check" data-gg-check>
          <h4>⚑ Rubric check</h4>
          <p>
            You entered <strong>{check.enteredPoints}</strong> of {critMax(check.criterionId)} for “{critTitle(check.criterionId)}”. Against this course's rubric
            the response reads as <strong>{check.suggestedLevel}</strong> ({check.suggestedPoints} pts)
            {check.missingConcepts.length > 0 && (
              <>
                {" "}because it is missing <strong>{check.missingConcepts.map(humanize).join(", ")}</strong>
              </>
            )}
            .
          </p>
          {check.bandDescriptor && <p className="gg-band-desc">Rubric band: “{check.bandDescriptor}”</p>}
          {check.evidence.length > 0 && (
            <ul className="gg-evidence">
              {check.evidence.slice(0, 2).map((q) => (
                <li key={q}>“{q}”</li>
              ))}
            </ul>
          )}
          <div className="gg-compare">
            <div>
              <div className="gg-n">{check.enteredPoints}</div>
              <div className="gg-l">your score</div>
            </div>
            <div>
              <div className="gg-n">{check.suggestedPoints}</div>
              <div className="gg-l">rubric-aligned</div>
            </div>
          </div>
          <p>Apply the rubric-aligned score and insert student-specific feedback?</p>
          <div className="gg-row">
            <button className="gg-btn gg-btn-primary" onClick={() => onApproveCheck(check)} data-gg-approve-check>
              Approve {check.suggestedPoints} pts + feedback
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
            On submission <strong>#{alert.priorSubmissionIndex}</strong>, missing the{" "}
            <strong>{humanize(alert.sharedConcept)}</strong> concept on “{critTitle(alert.criterionId)}” resulted in a{" "}
            <strong>−{alert.priorDeduction}</strong> point deduction. Here the same omission was penalized with{" "}
            <strong>−{alert.currentDeduction}</strong>.
          </p>
          <div className="gg-compare">
            <div>
              <div className="gg-n">−{alert.priorDeduction}</div>
              <div className="gg-l">submission #{alert.priorSubmissionIndex}</div>
            </div>
            <div>
              <div className="gg-n">−{alert.currentDeduction}</div>
              <div className="gg-l">this submission #{alert.currentSubmissionIndex}</div>
            </div>
          </div>
          <p>Would you like to align the criteria?</p>
          <div className="gg-row">
            <button className="gg-btn gg-btn-primary" onClick={() => onAlign(alert)} data-gg-align>
              Align to #{alert.priorSubmissionIndex} ({alert.priorPoints} pts)
            </button>
            <button className="gg-btn" onClick={() => onKeep(alert)} data-gg-keep>
              Keep mine
            </button>
          </div>
        </div>
      ) : (
        !check && (
          <div className="gg-status" data-gg-no-alert>
            No issues. Ghost Grader checks each score against this course's rubric and against your earlier decisions for the same omission.
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
                  #{h.priorSubmissionIndex} vs #{h.currentSubmissionIndex} · {humanize(h.sharedConcept)}
                </span>
                <span>
                  −{h.priorDeduction} / −{h.currentDeduction}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
