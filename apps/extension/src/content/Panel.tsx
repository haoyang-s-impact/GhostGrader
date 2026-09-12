import { useCallback, useEffect, useRef, useState } from "react";
import type { Decision, DriftAlert, Submission } from "@gg/shared";
import { api, ApiError } from "./api";
import { buildDecision } from "./decisions";
import { startObserver } from "./observer";
import { commentBox, pointsInputFor, setControlValue, type PageSubmission } from "./selectors";
import { loadMirror, saveMirror } from "./storage";
import { AlignmentTab, type AnalysisState } from "./tabs/AlignmentTab";
import { ConsistencyTab } from "./tabs/ConsistencyTab";
import { SessionTab } from "./tabs/SessionTab";

type Tab = "alignment" | "consistency" | "session";
type Mode = "claude" | "mock" | "offline" | "unknown";

export const TOTAL_SUBMISSIONS = 15;

export function Panel() {
  const [page, setPage] = useState<PageSubmission | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisState>({ status: "idle" });
  const [inserted, setInserted] = useState(false);
  const [alert, setAlert] = useState<DriftAlert | null>(null);
  const [alertHistory, setAlertHistory] = useState<DriftAlert[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [stats, setStats] = useState({ alertsRaised: 0, alertsAligned: 0 });
  const [tab, setTab] = useState<Tab>("alignment");
  const [mode, setMode] = useState<Mode>("unknown");
  const [collapsed, setCollapsed] = useState(false);

  // Refs so observer callbacks always see current state without re-subscribing.
  const pageRef = useRef<PageSubmission | null>(null);
  const analysisRef = useRef<AnalysisState>({ status: "idle" });
  const decisionsRef = useRef<Decision[]>([]);
  const requestSeq = useRef(0);
  const hydrated = useRef<string | null>(null);
  pageRef.current = page;
  analysisRef.current = analysis;
  decisionsRef.current = decisions;

  const refreshSession = useCallback(async (assignmentId: string) => {
    try {
      const s = await api.session(assignmentId);
      setDecisions(s.decisions);
      setStats({ alertsRaised: s.alertsRaised, alertsAligned: s.alertsAligned });
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

  const recordPoints = useCallback(
    async (criterionId: string, points: number | null) => {
      const p = pageRef.current;
      if (!p || points === null) return;
      const a = analysisRef.current;
      const d = buildDecision(p, criterionId, points, a.status === "ready" ? a.result : null);
      if (!d) return;
      const next = [...decisionsRef.current, d];
      setDecisions(next);
      void saveMirror(p.assignmentId, next);
      try {
        const { alert: incoming } = await api.decision(d);
        if (incoming) {
          setAlert(incoming);
          setAlertHistory((h) => [incoming, ...h]);
          setStats((s) => ({ ...s, alertsRaised: s.alertsRaised + 1 }));
          setTab("consistency");
        } else {
          setAlert((cur) => (cur && cur.criterionId === criterionId && cur.currentDecisionId === d.id ? null : cur));
        }
      } catch {
        setMode("offline");
      }
    },
    [],
  );

  useEffect(() => {
    const stop = startObserver({
      onSubmissionChanged: (s) => {
        setPage(s);
        setAlert(null);
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

  const onInsert = () => {
    if (analysis.status !== "ready") return;
    const box = commentBox();
    if (!box) return;
    setControlValue(box, analysis.result.feedbackDraft);
    setInserted(true);
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

  const openTab = (t: Tab) => {
    setTab(t);
    if (t === "session" && page) void refreshSession(page.assignmentId);
  };

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
          Consistency{alert && <span className="gg-badge">1</span>}
        </button>
        <button className={`gg-tab ${tab === "session" ? "is-active" : ""}`} onClick={() => openTab("session")} role="tab" data-gg-tab="session">Session</button>
      </div>
      <div className="gg-body">
        {tab === "alignment" && <AlignmentTab page={page} analysis={analysis} inserted={inserted} onRetry={() => page && analyze(page)} onInsert={onInsert} />}
        {tab === "consistency" && <ConsistencyTab page={page} alert={alert} history={alertHistory} onAlign={onAlign} onKeep={onKeep} />}
        {tab === "session" && <SessionTab page={page} decisions={decisions} alertsRaised={stats.alertsRaised} alertsAligned={stats.alertsAligned} totalSubmissions={TOTAL_SUBMISSIONS} />}
      </div>
    </div>
  );
}
