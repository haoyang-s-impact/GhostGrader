import { detectDrift, overrideKey, type Criterion, type Decision, type DriftAlert } from "@gg/shared";

export interface SessionState {
  decisions: Decision[];
  overrides: Set<string>;
  alertsRaised: number;
  alertsAligned: number;
}

export class SessionStore {
  private sessions = new Map<string, SessionState>();

  get(assignmentId: string): SessionState {
    let s = this.sessions.get(assignmentId);
    if (!s) {
      s = { decisions: [], overrides: new Set(), alertsRaised: 0, alertsAligned: 0 };
      this.sessions.set(assignmentId, s);
    }
    return s;
  }

  record(decision: Decision, criterion: Pick<Criterion, "maxPoints">): DriftAlert | null {
    const s = this.get(decision.assignmentId);
    const alert = detectDrift(decision, s.decisions, criterion, s.overrides);
    s.decisions.push(decision);
    if (alert) s.alertsRaised += 1;
    return alert;
  }

  override(assignmentId: string, a: string, b: string): void {
    this.get(assignmentId).overrides.add(overrideKey(a, b));
  }

  markAligned(assignmentId: string): void {
    this.get(assignmentId).alertsAligned += 1;
  }

  reset(assignmentId: string): void {
    this.sessions.delete(assignmentId);
  }
}
