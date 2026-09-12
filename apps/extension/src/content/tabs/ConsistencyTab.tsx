import type { DriftAlert } from "@gg/shared";
import type { PageSubmission } from "../selectors";

interface Props {
  page: PageSubmission | null;
  alert: DriftAlert | null;
  history: DriftAlert[];
  onAlign: (alert: DriftAlert) => void;
  onKeep: (alert: DriftAlert) => void;
}

function humanize(tag: string) {
  return tag.replace(/_/g, " ");
}

export function ConsistencyTab({ page, alert, history, onAlign, onKeep }: Props) {
  const critTitle = (id: string) => page?.rubric.find((r) => r.criterionId === id)?.title ?? id;

  return (
    <>
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
        <div className="gg-status" data-gg-no-alert>
          No inconsistencies detected. Ghost Grader compares each deduction with earlier decisions for the same omission.
        </div>
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
