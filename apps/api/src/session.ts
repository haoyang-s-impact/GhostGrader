import { detectDrift, overrideKey, type Decision, type DriftAlert } from "@gg/shared";
import type { Store } from "./store";

/** Grading-session operations on top of the persistent store. */
export class SessionService {
  constructor(private readonly store: Store) {}

  get(assignmentId: string) {
    return this.store.session(assignmentId);
  }

  record(decision: Decision): DriftAlert | null {
    const s = this.store.session(decision.assignmentId);
    const alert = detectDrift(decision, s.decisions, new Set(s.overrides));
    s.decisions.push(decision);
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

  bump(assignmentId: string, field: "alertsAligned" | "checksRaised" | "checksApproved") {
    const s = this.store.session(assignmentId);
    s[field] += 1;
    this.store.saveSession(assignmentId, s);
  }

  reset(assignmentId: string) {
    this.store.resetSession(assignmentId);
  }
}
