import { useCallback, useEffect, useRef, useState } from "react";
import { checkScore, type Decision, type DriftAlert, type ScoreCheck, type Submission } from "@gg/shared";
import { api, ApiError, setTeacherId } from "./api";
import { buildDecision } from "./decisions";
import { startObserver } from "./observer";
import { commentBox, gradeInput, setControlValue, type PageSubmission } from "./selectors";
import { loadMirror, saveMirror } from "./storage";
import { AlignmentTab, type AnalysisState } from "./tabs/AlignmentTab";
import { ConsistencyTab } from "./tabs/ConsistencyTab";
import { SessionTab } from "./tabs/SessionTab";

type Tab = "alignment" | "consistency" | "session";
type Mode = "claude" | "openrouter" | "mock" | "offline" | "unknown";

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
  const [modelName, setModelName] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [recording, setRecording] = useState(false);

  // Refs so observer callbacks always see current state without re-subscribing.
  const pageRef = useRef<PageSubmission | null>(null);
  const analysisRef = useRef<AnalysisState>({ status: "idle" });
  const decisionsRef = useRef<Decision[]>([]);
  const checkDismissed = useRef(false);
  const checkCounted = useRef(false);
  const analyzePromise = useRef<Promise<void> | null>(null);
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

  const analyze = useCallback((p: PageSubmission) => {
    const seq = ++requestSeq.current;
    setAnalysis({ status: "loading" });
    setInserted(false);
    const submission: Submission = { id: p.submissionId, index: p.submissionIndex, studentName: p.studentName, text: p.text };
    const run = async () => {
      try {
        const result = await api.analyze(p.assignmentId, submission);
        if (seq !== requestSeq.current) return;
        setAnalysis({ status: "ready", result });
        analysisRef.current = { status: "ready", result };
      } catch (err) {
        if (seq !== requestSeq.current) return;
        const e = err instanceof ApiError ? err : new ApiError("Analysis failed.", true);
        setAnalysis({ status: "error", message: e.message, retryable: e.retryable });
        analysisRef.current = { status: "error", message: e.message, retryable: e.retryable };
        if (e.status === undefined) setMode("offline");
      }
    };
    // Held so a submit that lands mid-analysis can wait for the suggestion
    // instead of recording suggestedPoints: null, which would hide this
    // student from the cross-student comparison for good.
    const promise = run();
    analyzePromise.current = promise;
    return promise;
  }, []);

  // Hydrate: health, then session; replay mirrored decisions if the server has none.
  const hydrate = useCallback(
    async (assignmentId: string) => {
      if (hydrated.current === assignmentId) return;
      hydrated.current = assignmentId;
      setAlertHistory([]);
      try {
        const h = await api.health();
        setMode(h.analyzer);
        setModelName(h.model ?? "");
      } catch {
        setMode("offline");
        return;
      }
      try {
        const s = await api.session(assignmentId);
        if (s.decisions.length === 0) {
          const mirror = await loadMirror(assignmentId);
          // Replay: restore the rows without re-raising alerts the teacher already resolved.
          for (const d of [...mirror].sort((a, b) => a.at - b.at)) await api.decision(d, true).catch(() => undefined);
        }
      } catch {
        /* fall through to refresh */
      }
      await refreshSession(assignmentId);
    },
    [refreshSession],
  );

  /**
   * The grade in the box changed. This is a draft: it drives the rubric check,
   * which only compares this student's grade with this student's own analysis,
   * so a half-typed number is harmless and corrects itself on the next
   * keystroke. Nothing is recorded and nobody else is compared.
   */
  const gradeTyped = useCallback((points: number | null) => {
    const p = pageRef.current;
    if (!p) return;
    setPage({ ...p, grade: points });
    const a = analysisRef.current;
    const ready = a.status === "ready" ? a.result : null;
    if (!ready || points === null) {
      setCheck(null);
      checkCounted.current = false;
      return;
    }
    const sc = checkScore(ready, points);
    if (!sc) {
      setCheck(null);
      checkCounted.current = false; // back within the threshold; a later breach is a new raise
      return;
    }
    if (checkDismissed.current) return;
    setCheck(sc);
    setTab("consistency");
    if (!checkCounted.current) {
      checkCounted.current = true;
      setStats((s) => ({ ...s, checksRaised: s.checksRaised + 1 }));
      void api.checkRaised(p.assignmentId, p.submissionId).catch(() => undefined);
    }
  }, []);

  /**
   * The teacher clicked Submit. Only now does the grade become a decision and
   * get compared with the grades given to other students.
   */
  const gradeSubmitted = useCallback(async (points: number) => {
    const p = pageRef.current;
    if (!p) return;
    setPage({ ...p, grade: points, submittedPoints: points });
    // Wait out an analysis still in flight, so the decision carries the
    // rubric-referenced suggestion rather than null.
    if (analysisRef.current.status === "loading" && analyzePromise.current) {
      setRecording(true);
      await analyzePromise.current.catch(() => undefined);
      setRecording(false);
      if (pageRef.current?.submissionId !== p.submissionId) return;
    }
    const a = analysisRef.current;
    const ready = a.status === "ready" ? a.result : null;
    const d = buildDecision(p, points, ready);
    if (!d) return;
    const next = [...decisionsRef.current.filter((x) => x.id !== d.id), d];
    setDecisions(next);
    void saveMirror(p.assignmentId, next);

    // Comparison with other students, decided server-side over the session history.
    try {
      const { alert: incoming } = await api.decision(d);
      if (incoming) {
        setAlert(incoming);
        setAlertHistory((h) => [incoming, ...h]);
        setStats((s) => ({ ...s, alertsRaised: s.alertsRaised + 1 }));
        setTab("consistency");
      } else {
        setAlert(null);
      }
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
        setTab("alignment"); // a new student always starts on the Grade tab
        checkDismissed.current = false; // a dismissal only lasts while that submission stays open
        checkCounted.current = false;
        void hydrate(s.assignmentId);
        void analyze(s);
      },
      onSubmissionMissing: () => {
        setPage(null);
        setAnalysis({ status: "idle" });
      },
      onGradeTyped: (points) => gradeTyped(points),
      onGradeSubmitted: (points) => void gradeSubmitted(points),
    });
    return stop;
  }, [analyze, hydrate, gradeTyped, gradeSubmitted]);

  // A grade already in the box when the analysis lands (a reopened student, or
  // one typed while the request was in flight) still deserves the rubric check.
  useEffect(() => {
    if (analysis.status !== "ready") return;
    if (page?.grade === null || page?.grade === undefined) return;
    gradeTyped(page.grade);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis.status, page?.submissionId]);

  const insertFeedback = () => {
    if (analysis.status !== "ready") return false;
    const box = commentBox();
    if (!box) return false;
    setControlValue(box, analysis.result.feedbackDraft);
    setInserted(true);
    return true;
  };

  const writeGrade = (points: number) => {
    const input = gradeInput();
    if (input) setControlValue(input, String(points));
  };

  const onApplyGrade = () => {
    if (analysis.status !== "ready") return;
    checkDismissed.current = true;
    writeGrade(analysis.result.suggestedTotal);
    setCheck(null);
  };

  const onAlign = (a: DriftAlert) => {
    checkDismissed.current = true;
    writeGrade(a.recommendedPoints);
    setAlert(null);
    setStats((s) => ({ ...s, alertsAligned: s.alertsAligned + 1 }));
    if (page) void api.aligned(page.assignmentId).catch(() => undefined);
  };

  const onKeep = (a: DriftAlert) => {
    setAlert(null);
    if (page) void api.override(page.assignmentId, a.currentDecisionId, a.priorDecisionId).catch(() => undefined);
  };

  /** Teacher approves the rubric-referenced grade: write it to the LMS and drop in the feedback. */
  const onApproveCheck = (c: ScoreCheck) => {
    checkDismissed.current = true;
    writeGrade(c.suggestedPoints);
    insertFeedback();
    setCheck(null);
    setStats((s) => ({ ...s, checksApproved: s.checksApproved + 1 }));
    if (page) void api.checkApproved(page.assignmentId).catch(() => undefined);
  };

  const onDismissCheck = () => {
    checkDismissed.current = true;
    setCheck(null);
  };

  const openTab = (t: Tab) => {
    setTab(t);
    if (t === "session" && page) void refreshSession(page.assignmentId);
  };

  const pending = (alert ? 1 : 0) + (check ? 1 : 0);
  // The grade in the box differs from what was committed, so it is not recorded yet.
  const unsubmitted = page !== null && page.grade !== null && page.grade !== page.submittedPoints;
  const modeLabel =
    mode === "claude" ? "Claude" : mode === "openrouter" ? modelName.split("/").pop() || "OpenRouter" : mode === "mock" ? "Mock mode" : mode === "offline" ? "Offline" : "…";

  return (
    <div className={`gg-root ${collapsed ? "is-collapsed" : ""}`} data-gg-panel data-gg-analysis={analysis.status}>
      <div className="gg-header">
        <button className="gg-iconbtn" onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? "Expand Ghost Grader" : "Collapse Ghost Grader"} data-gg-toggle>
          {collapsed ? "‹" : "›"}
        </button>
        <div className="gg-ghost">👻</div>
        <div className="gg-title">Ghost Grader</div>
        {unsubmitted && (
          <span className="gg-chip is-unsubmitted" data-gg-unsubmitted title="This grade is not recorded until you click Submit">
            Not submitted
          </span>
        )}
        <span className={`gg-chip ${mode === "mock" ? "is-mock" : mode === "offline" ? "is-offline" : ""}`} data-gg-mode={mode} title={modelName}>
          {recording ? "recording…" : modeLabel}
        </span>
      </div>
      <div className="gg-tabs" role="tablist">
        <button className={`gg-tab ${tab === "alignment" ? "is-active" : ""}`} onClick={() => openTab("alignment")} role="tab" data-gg-tab="alignment">Grade</button>
        <button className={`gg-tab ${tab === "consistency" ? "is-active" : ""}`} onClick={() => openTab("consistency")} role="tab" data-gg-tab="consistency">
          Checks{pending > 0 && <span className="gg-badge">{pending}</span>}
        </button>
        <button className={`gg-tab ${tab === "session" ? "is-active" : ""}`} onClick={() => openTab("session")} role="tab" data-gg-tab="session">Session</button>
      </div>
      <div className="gg-body">
        {tab === "alignment" && (
          <AlignmentTab page={page} analysis={analysis} inserted={inserted} onRetry={() => page && analyze(page)} onInsert={() => void insertFeedback()} onApplyGrade={onApplyGrade} />
        )}
        {tab === "consistency" && (
          <ConsistencyTab page={page} unsubmitted={unsubmitted} alert={alert} check={check} history={alertHistory} onAlign={onAlign} onKeep={onKeep} onApproveCheck={onApproveCheck} onDismissCheck={onDismissCheck} />
        )}
        {tab === "session" && (
          <SessionTab
            decisions={decisions}
            alertsRaised={stats.alertsRaised}
            alertsAligned={stats.alertsAligned}
            checksRaised={stats.checksRaised}
            checksApproved={stats.checksApproved}
            totalSubmissions={page?.totalSubmissions ?? 0}
            maxPoints={page?.maxPoints ?? 0}
          />
        )}
      </div>
    </div>
  );
}
