import { detectDrift, overrideKey, type Decision, type DriftAlert } from "@gg/shared";
import type { Store } from "./store";

/** Grading-session operations on top of the persistent store. */
export class SessionService {
  constructor(private readonly store: Store) {}

  get(assignmentId: string) {
    return this.store.session(assignmentId);
  }

  /**
   * Record a submitted grade. Decision ids are deterministic per answer, so
   * re-grading a student's answer replaces their row: the session holds each
   * answer's latest grade and nothing else. Drift is checked against other
   * students on the same question.
   */
  record(decision: Decision): DriftAlert | null {
    const s = this.store.session(decision.assignmentId);
    const alert = detectDrift(decision, s.decisions, new Set(s.overrides));
    const at = s.decisions.findIndex((d) => d.id === decision.id);
    if (at === -1) s.decisions.push(decision);
    else s.decisions[at] = decision;
    if (alert) s.alertsRaised += 1;
    this.store.saveSession(decision.assignmentId, s);
    return alert;
  }

  override(assignmentId: string, a: string, b: string) {
    const s = this.store.session(assignmentId);
    const k = overrideKey(a, b);
    if (!s.overrides.includes(k)) s.overrides.push(k);
    this.store.saveSession(assignmentId, s);
  }

  /**
   * `answerId` makes a checksRaised bump idempotent for that answer: the check
   * is evaluated live as the teacher types, so it would otherwise count once
   * per keystroke. Passing none always counts.
   */
  bump(assignmentId: string, field: "alertsAligned" | "checksRaised" | "checksApproved", answerId?: string) {
    const s = this.store.session(assignmentId);
    if (field === "checksRaised" && answerId) {
      const seen = (s.checksRaisedFor ??= []);
      if (seen.includes(answerId)) return;
      seen.push(answerId);
    }
    s[field] += 1;
    this.store.saveSession(assignmentId, s);
  }

  reset(assignmentId: string) {
    this.store.resetSession(assignmentId);
  }
}
