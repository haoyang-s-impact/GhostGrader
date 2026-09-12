import type { DriftAlert, ScoreCheck } from "@gg/shared";
import type { PageAttempt } from "../moodle";

export interface PendingCheck {
  lmsId: string;
  check: ScoreCheck;
}

export interface PendingAlert {
  lmsId: string;
  alert: DriftAlert;
}

interface Props {
  attempts: PageAttempt[];
  checks: PendingCheck[];
  alerts: PendingAlert[];
  saveHint: string | null;
  onApproveCheck: (lmsId: string) => void;
  onDismissCheck: (lmsId: string) => void;
  onAlign: (p: PendingAlert) => void;
  onKeep: (p: PendingAlert) => void;
}

const humanize = (tag: string) => tag.replace(/_/g, " ");
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

export function ChecksTab({ attempts, checks, alerts, saveHint, onApproveCheck, onDismissCheck, onAlign, onKeep }: Props) {
  const nameOf = (lmsId: string) => attempts.find((a) => a.lmsId === lmsId)?.studentName ?? lmsId;
  return (
    <>
      {saveHint && <div className="gg-hint" data-gg-save-hint>{saveHint}</div>}

      {alerts.map((p) => (
        <div className="gg-alert" data-gg-alert key={p.alert.currentDecisionId + p.alert.priorDecisionId}>
          <h4>⚠ Consistency alert · {nameOf(p.lmsId)}</h4>
          <p>
            <strong>{p.alert.priorStudentName || `Student #${p.alert.priorStudentIndex}`}</strong> had the same gap
            {p.alert.sharedConcepts.length > 0 && (
              <>
                , <strong>{p.alert.sharedConcepts.map(humanize).join(", ")}</strong>,
              </>
            )}{" "}
            and you graded them <strong>{p.alert.priorPoints}</strong> against a rubric-referenced {p.alert.priorSuggested} ({signed(p.alert.priorOffset)}). Here you entered{" "}
            <strong>{p.alert.currentPoints}</strong> against {p.alert.currentSuggested} ({signed(p.alert.currentOffset)}).
          </p>
          <div className="gg-compare">
            <div>
              <div className="gg-n">{p.alert.priorPoints}</div>
              <div className="gg-l">{p.alert.priorStudentName || `#${p.alert.priorStudentIndex}`}</div>
            </div>
            <div>
              <div className="gg-n">{p.alert.currentPoints}</div>
              <div className="gg-l">{nameOf(p.lmsId)}</div>
            </div>
          </div>
          <div className="gg-row">
            <button className="gg-btn gg-btn-sm gg-btn-primary" onClick={() => onAlign(p)} data-gg-align>
              Align to {p.alert.recommendedPoints}
            </button>
            <button className="gg-btn gg-btn-sm" onClick={() => onKeep(p)} data-gg-keep>
              Keep mine
            </button>
          </div>
        </div>
      ))}

      {checks.map((p) => (
        <div className="gg-alert gg-check" data-gg-check key={p.lmsId}>
          <h4>⚑ Rubric check · {nameOf(p.lmsId)}</h4>
          <p>
            You entered <strong>{p.check.enteredPoints}</strong> of {p.check.maxPoints}. Referenced against this question's rubric, the answer earns{" "}
            <strong>{p.check.suggestedPoints}</strong>
            {p.check.missingConcepts.length > 0 && (
              <>
                {" "}because it is missing <strong>{p.check.missingConcepts.map(humanize).join(", ")}</strong>
              </>
            )}
            .
          </p>
          {p.check.summary && <p className="gg-none">{p.check.summary}</p>}
          <div className="gg-compare">
            <div>
              <div className="gg-n">{p.check.enteredPoints}</div>
              <div className="gg-l">your mark</div>
            </div>
            <div>
              <div className="gg-n">{p.check.suggestedPoints}</div>
              <div className="gg-l">rubric-referenced</div>
            </div>
          </div>
          <div className="gg-row">
            <button className="gg-btn gg-btn-sm gg-btn-primary" onClick={() => onApproveCheck(p.lmsId)} data-gg-approve-check>
              Approve {p.check.suggestedPoints} + feedback
            </button>
            <button className="gg-btn gg-btn-sm" onClick={() => onDismissCheck(p.lmsId)} data-gg-dismiss-check>
              Keep mine
            </button>
          </div>
        </div>
      ))}

      {alerts.length === 0 && checks.length === 0 && !saveHint && (
        <div className="gg-status" data-gg-no-alert>
          No issues. Marks are checked against the rubric as you type, and against the other students' marks when you click Save.
        </div>
      )}
    </>
  );
}
