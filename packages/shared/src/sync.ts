import type { Decision, PushRecord } from "./schemas";

/** Small stable string hash (djb2), so a comment edit changes the push reference. */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Content-addressed push reference. The same grade and comment for the same
 * answer always produce the same reference, so the LMS can upsert on it and a
 * repeated push is a no-op; a re-grade or a feedback edit produces a new one.
 */
export function pushReference(answerId: string, points: number, comment = ""): string {
  return comment ? `${answerId}:${points}:${hash(comment)}` : `${answerId}:${points}`;
}

export function decisionReference(d: Pick<Decision, "answerId" | "points" | "comment">): string {
  return pushReference(d.answerId, d.points, d.comment);
}

/** The latest decision per answer; re-grading replaces. */
export function latestDecisions(decisions: Decision[]): Decision[] {
  const out = new Map<string, Decision>();
  for (const d of decisions) {
    const prev = out.get(d.answerId);
    if (!prev || d.at > prev.at) out.set(d.answerId, d);
  }
  return [...out.values()];
}

/** The most recent push attempt per answer. Later entries win. */
export function latestPushes(pushes: PushRecord[]): Map<string, PushRecord> {
  const out = new Map<string, PushRecord>();
  for (const p of pushes) out.set(p.answerId, p);
  return out;
}

/**
 * Decisions whose current grade the LMS does not hold. Compared against the
 * latest push per answer only: the LMS keeps one grade per student and
 * question, so pushing 20, then 23, then re-grading back to 20 must push again
 * even though "20" was delivered once before.
 */
export function pendingPush(decisions: Decision[], pushes: PushRecord[]): Decision[] {
  const latest = latestPushes(pushes);
  return latestDecisions(decisions).filter((d) => {
    const p = latest.get(d.answerId);
    return !(p && p.status === "pushed" && p.clientReferenceId === decisionReference(d));
  });
}

export interface SyncSummary {
  graded: number;
  pushed: number;
  pending: number;
  /** Pending grades whose most recent push attempt failed. */
  failed: number;
}

export function syncSummary(decisions: Decision[], pushes: PushRecord[]): SyncSummary {
  const graded = latestDecisions(decisions);
  const pending = pendingPush(decisions, pushes);
  const latest = latestPushes(pushes);
  return {
    graded: graded.length,
    pushed: graded.length - pending.length,
    pending: pending.length,
    failed: pending.filter((d) => latest.get(d.answerId)?.status === "failed").length,
  };
}
