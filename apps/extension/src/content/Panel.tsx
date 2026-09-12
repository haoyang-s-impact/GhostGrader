import { useCallback, useEffect, useRef, useState } from "react";
import { checkScore, type Decision, type DriftAlert, type ScoreCheck, type Submission } from "@gg/shared";
import { api, ApiError, setTeacherId } from "./api";
import { buildDecision } from "./decisions";
import { startObserver } from "./observer";
import { commentBox, pointsInputFor, setControlValue, type PageSubmission } from "./selectors";
import { loadMirror, saveMirror } from "./storage";
import { AlignmentTab, type AnalysisState } from "./tabs/AlignmentTab";
import { ConsistencyTab } from "./tabs/ConsistencyTab";
import { SessionTab } from "./tabs/SessionTab";

type Tab = "alignment" | "consistency" | "session";
type Mode = "claude" | "mock" | "offline" | "unknown";

const emptyStats = { alertsRaised: 0, alertsAligned: 0, checksRaised: 0, checksApproved: 0 };

export function Panel() {
  const [page, setPage] = useState<PageSubmission | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisState>({ status: "idle" });
  const [inserted, setInserted] = useState(false);
  const [alert, setAlert] = useState<DriftAlert | null>(null);
  const [check, setCheck] = useState<ScoreCheck | null>(null);
  const [alertHistory, setAlertHistory] = useState<DriftAlert[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [stats, setStats] = useState(emptyStats);
  const [tab, setTab] = useState<Tab>("alignment");
  const [mode, setMode] = useState<Mode>("unknown");
  const [collapsed, setCollapsed] = useState(false);

  // Refs so observer callbacks always see current state without re-subscribing.
  const pageRef = useRef<PageSubmission | null>(null);
  const analysisRef = useRef<AnalysisState>({ status: "idle" });
  const decisionsRef = useRef<Decision[]>([]);
  const dismissedChecks = useRef<Set<string>>(new Set());
  const requestSeq = useRef(0);
  const hydrated = useRef<string | null>(null);
  pageRef.current = page;
  analysisRef.current = analysis;
  decisionsRef.current = decisions;

  const refreshSession = useCallback(async (assignmentId: string) => {
    try {
      const s = await api.session(assignmentId);
      setDecisions(s.decisions);
      setStats({ alertsRaised: s.alertsRaised, alertsAligned: s.alertsAligned, checksRaised: s.checksRaised, checksApproved: s.checksApproved });
      void saveMirror(assignmentId, s.decisions);
    } catch {
      /* dashboard is best-effort */
    }
  }, []);

  const analyze = useCallback(async (p: PageSubmission) => {
    const seq = ++requestSeq.current;
    setAnalysis({ status: "loading" });
    setInserted(false);
    const submission: Submission = { id: p.submissionId, index: p.submissionIndex, studentName: p.studentName, text: p.text };
    try {
      const result = await api.analyze(p.assignmentId, submission);
      if (seq !== requestSeq.current) return;
      setAnalysis({ status: "ready", result });
    } catch (err) {
      if (seq !== requestSeq.current) return;
      const e = err instanceof ApiError ? err : new ApiError("Analysis failed.", true);
      setAnalysis({ status: "error", message: e.message, retryable: e.retryable });
      if (e.status === undefined) setMode("offline");
    }
  }, []);

  // Hydrate: health, then session; replay mirrored decisions if the server has none.
  const hydrate = useCallback(
    async (assignmentId: string) => {
      if (hydrated.current === assignmentId) return;
      hydrated.current = assignmentId;
      setAlertHistory([]);
      dismissedChecks.current.clear();
      try {
        const h = await api.health();
        setMode(h.analyzer);
      } catch {
        setMode("offline");
        return;
      }
      try {
        const s = await api.session(assignmentId);
        if (s.decisions.length === 0) {
          const mirror = await loadMirror(assignmentId);
          for (const d of [...mirror].sort((a, b) => a.at - b.at)) await api.decision(d).catch(() => undefined);
        }
      } catch {
        /* fall through to refresh */
      }
      await refreshSession(assignmentId);
    },
    [refreshSession],
  );

  const recordPoints = useCallback(async (criterionId: string, points: number | null) => {
    const p = pageRef.current;
    if (!p || points === null) return;
    const a = analysisRef.current;
    const ready = a.status === "ready" ? a.result : null;
    const d = buildDecision(p, criterionId, points, ready);
    if (!d) return;
    const next = [...decisionsRef.current, d];
    setDecisions(next);
    void saveMirror(p.assignmentId, next);

    // Rubric check: does this score match what the rubric-bound analysis says?
    const row = p.rubric.find((r) => r.criterionId === criterionId);
    const ca = ready?.criteria.find((c) => c.criterionId === criterionId);
    let raisedCheck = false;
    if (row && ca) {
      const sc = checkScore({ id: row.criterionId, maxPoints: row.maxPoints }, ca, points);
      const key = `${p.submissionId}:${criterionId}`;
      if (sc && !dismissedChecks.current.has(key)) {
        setCheck(sc);
        raisedCheck = true;
        setStats((s) => ({ ...s, checksRaised: s.checksRaised + 1 }));
        void api.checkRaised(p.assignmentId).catch(() => undefined);
      } else {
        setCheck((cur) => (cur && cur.criterionId === criterionId ? null : cur));
      }
    }

    try {
      const { alert: incoming } = await api.decision(d);
      if (incoming) {
        setAlert(incoming);
        setAlertHistory((h) => [incoming, ...h]);
        setStats((s) => ({ ...s, alertsRaised: s.alertsRaised + 1 }));
      } else {
        setAlert((cur) => (cur && cur.criterionId === criterionId && cur.currentDecisionId === d.id ? null : cur));
      }
      if (incoming || raisedCheck) setTab("consistency");
    } catch {
      setMode("offline");
    }
  }, []);

  useEffect(() => {
    const stop = startObserver({
      onSubmissionChanged: (s) => {
        setTeacherId(s.teacherId);
        setPage(s);
        setAlert(null);
        setCheck(null);
        dismissedChecks.current.clear(); // a dismissal only lasts while that submission stays open
        void hydrate(s.assignmentId);
        void analyze(s);
      },
      onSubmissionMissing: () => {
        setPage(null);
        setAnalysis({ status: "idle" });
      },
      onPointsChanged: (criterionId, points) => void recordPoints(criterionId, points),
    });
    return stop;
  }, [analyze, hydrate, recordPoints]);

  const insertFeedback = () => {
    if (analysis.status !== "ready") return false;
    const box = commentBox();
    if (!box) return false;
    setControlValue(box, analysis.result.feedbackDraft);
    setInserted(true);
    return true;
  };

  const onAlign = (a: DriftAlert) => {
    const input = pointsInputFor(a.criterionId);
    if (input) setControlValue(input, String(a.priorPoints));
    setAlert(null);
    setStats((s) => ({ ...s, alertsAligned: s.alertsAligned + 1 }));
    if (page) void api.aligned(page.assignmentId).catch(() => undefined);
  };

  const onKeep = (a: DriftAlert) => {
    setAlert(null);
    if (page) void api.override(page.assignmentId, a.currentDecisionId, a.priorDecisionId).catch(() => undefined);
  };

  /** Teacher approves the AI's rubric-aligned score: write it to the LMS and drop in the feedback. */
  const onApproveCheck = (c: ScoreCheck) => {
    if (page) dismissedChecks.current.add(`${page.submissionId}:${c.criterionId}`);
    const input = pointsInputFor(c.criterionId);
    if (input) setControlValue(input, String(c.suggestedPoints));
    insertFeedback();
    setCheck(null);
    setStats((s) => ({ ...s, checksApproved: s.checksApproved + 1 }));
    if (page) void api.checkApproved(page.assignmentId).catch(() => undefined);
  };

  const onDismissCheck = (c: ScoreCheck) => {
    if (page) dismissedChecks.current.add(`${page.submissionId}:${c.criterionId}`);
    setCheck(null);
  };

  const openTab = (t: Tab) => {
    setTab(t);
    if (t === "session" && page) void refreshSession(page.assignmentId);
  };

  const pending = (alert ? 1 : 0) + (check ? 1 : 0);
  const modeLabel = mode === "claude" ? "Claude" : mode === "mock" ? "Mock mode" : mode === "offline" ? "Offline" : "…";

  return (
    <div className={`gg-root ${collapsed ? "is-collapsed" : ""}`} data-gg-panel data-gg-analysis={analysis.status}>
      <div className="gg-header">
        <button className="gg-iconbtn" onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? "Expand Ghost Grader" : "Collapse Ghost Grader"} data-gg-toggle>
          {collapsed ? "‹" : "›"}
        </button>
        <div className="gg-ghost">👻</div>
        <div className="gg-title">Ghost Grader</div>
        <span className={`gg-chip ${mode === "mock" ? "is-mock" : mode === "offline" ? "is-offline" : ""}`} data-gg-mode={mode}>
          {modeLabel}
        </span>
      </div>
      <div className="gg-tabs" role="tablist">
        <button className={`gg-tab ${tab === "alignment" ? "is-active" : ""}`} onClick={() => openTab("alignment")} role="tab" data-gg-tab="alignment">Alignment</button>
        <button className={`gg-tab ${tab === "consistency" ? "is-active" : ""}`} onClick={() => openTab("consistency")} role="tab" data-gg-tab="consistency">
          Checks{pending > 0 && <span className="gg-badge">{pending}</span>}
        </button>
        <button className={`gg-tab ${tab === "session" ? "is-active" : ""}`} onClick={() => openTab("session")} role="tab" data-gg-tab="session">Session</button>
      </div>
      <div className="gg-body">
        {tab === "alignment" && <AlignmentTab page={page} analysis={analysis} inserted={inserted} onRetry={() => page && analyze(page)} onInsert={() => void insertFeedback()} />}
        {tab === "consistency" && (
          <ConsistencyTab page={page} alert={alert} check={check} history={alertHistory} onAlign={onAlign} onKeep={onKeep} onApproveCheck={onApproveCheck} onDismissCheck={onDismissCheck} />
        )}
        {tab === "session" && (
          <SessionTab page={page} decisions={decisions} alertsRaised={stats.alertsRaised} alertsAligned={stats.alertsAligned} checksRaised={stats.checksRaised} checksApproved={stats.checksApproved} totalSubmissions={page?.totalSubmissions ?? 0} />
        )}
      </div>
    </div>
  );
}
