import { useCallback, useEffect, useRef, useState } from "react";
import { checkScore, type Decision, type DriftAlert, type ScoreCheck } from "@gg/shared";
import { api, ApiError, type Health } from "../api";
import { buildDecision, latestByAnswer, type GradingTarget } from "./decisions";
import type { AnalysisState } from "./tabs/AlignmentTab";

export type Tab = "alignment" | "consistency" | "session";
export type Mode = Health["analyzer"] | "offline" | "unknown";

const emptyStats = { alertsRaised: 0, alertsAligned: 0, checksRaised: 0, checksApproved: 0 };

/** The grade form lives in the page; the hook reads it and writes to it. */
export interface GradeForm {
  grade: number | null;
  setGrade: (points: number | null) => void;
  comment: string;
  setComment: (text: string) => void;
}

/**
 * Everything Ghost Grader does while a teacher grades one answer: analysis
 * against the question's rubric, the live rubric check on the draft grade,
 * recording a submitted grade and the cross-student comparison it triggers,
 * and the session stats. The grade and comment are ordinary form state owned
 * by the page: typing is a draft, and only Submit records a decision.
 */
export function useGrading(target: GradingTarget | null, form: GradeForm) {
  const [analysis, setAnalysis] = useState<AnalysisState>({ status: "idle" });
  const [inserted, setInserted] = useState(false);
  const [alert, setAlert] = useState<DriftAlert | null>(null);
  const [check, setCheck] = useState<ScoreCheck | null>(null);
  const [alertHistory, setAlertHistory] = useState<DriftAlert[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [stats, setStats] = useState(emptyStats);
  const [tab, setTab] = useState<Tab>("alignment");
  const [health, setHealth] = useState<Health | null>(null);
  const [offline, setOffline] = useState(false);
  const [recording, setRecording] = useState(false);

  const targetRef = useRef<GradingTarget | null>(target);
  const analysisRef = useRef<AnalysisState>({ status: "idle" });
  const decisionsRef = useRef<Decision[]>([]);
  const checkDismissed = useRef(false);
  const checkCounted = useRef(false);
  const analyzePromise = useRef<Promise<void> | null>(null);
  const requestSeq = useRef(0);
  targetRef.current = target;
  analysisRef.current = analysis;
  decisionsRef.current = decisions;

  const assignmentId = target?.assignmentId;
  const answerId = target?.answer.id;

  const refreshSession = useCallback(async (id: string) => {
    try {
      const s = await api.session(id);
      setDecisions(s.decisions);
      setStats({ alertsRaised: s.alertsRaised, alertsAligned: s.alertsAligned, checksRaised: s.checksRaised, checksApproved: s.checksApproved });
    } catch {
      /* the dashboard is best-effort */
    }
  }, []);

  // A new assignment: health and session history.
  useEffect(() => {
    if (!assignmentId) return;
    setAlertHistory([]);
    api.health().then(
      (h) => {
        setHealth(h);
        setOffline(false);
      },
      () => setOffline(true),
    );
    void refreshSession(assignmentId);
  }, [assignmentId, refreshSession]);

  const analyze = useCallback((t: GradingTarget) => {
    const seq = ++requestSeq.current;
    setAnalysis({ status: "loading" });
    setInserted(false);
    const run = async () => {
      try {
        const result = await api.analyze(t.assignmentId, t.questionId, t.answer.id);
        if (seq !== requestSeq.current) return;
        analysisRef.current = { status: "ready", result };
        setAnalysis(analysisRef.current);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        const e = err instanceof ApiError ? err : new ApiError("Analysis failed.", true);
        analysisRef.current = { status: "error", message: e.message, retryable: e.retryable };
        setAnalysis(analysisRef.current);
        if (e.status === undefined) setOffline(true);
      }
    };
    // Held so a submit that lands mid-analysis can wait for the suggestion
    // instead of recording suggestedPoints: null, which would hide this
    // student from the cross-student comparison for good.
    const promise = run();
    analyzePromise.current = promise;
    return promise;
  }, []);

  // A new answer: every intervention starts fresh, on the Grade tab.
  useEffect(() => {
    const t = targetRef.current;
    if (!t) {
      setAnalysis({ status: "idle" });
      return;
    }
    setAlert(null);
    setCheck(null);
    setTab("alignment");
    checkDismissed.current = false; // a dismissal only lasts while that answer stays open
    checkCounted.current = false;
    void analyze(t);
  }, [answerId, analyze]);

  /**
   * The draft grade changed, or the analysis arrived. This drives the rubric
   * check, which compares this student's grade with this student's own
   * analysis only, so a half-typed number is harmless. Nothing is recorded.
   */
  useEffect(() => {
    const t = targetRef.current;
    const ready = analysis.status === "ready" && analysis.result.answerId === t?.answer.id ? analysis.result : null;
    if (!t || !ready || form.grade === null) {
      setCheck(null);
      checkCounted.current = false;
      return;
    }
    const sc = checkScore(ready, form.grade);
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
      void api.checkRaised(t.assignmentId, t.answer.id).catch(() => undefined);
    }
  }, [form.grade, analysis]);

  /** Submit: only now does the grade become a decision and get compared with other students. */
  const submit = useCallback(async () => {
    const t = targetRef.current;
    const points = form.grade;
    if (!t || points === null) return;
    // Wait out an analysis still in flight, so the decision carries the suggestion rather than null.
    if (analysisRef.current.status === "loading" && analyzePromise.current) {
      setRecording(true);
      await analyzePromise.current.catch(() => undefined);
      setRecording(false);
      if (targetRef.current?.answer.id !== t.answer.id) return;
    }
    const a = analysisRef.current;
    const d = buildDecision(t, points, form.comment, a.status === "ready" ? a.result : null);
    if (!d) return;
    setDecisions([...decisionsRef.current.filter((x) => x.id !== d.id), d]);
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
      setOffline(true);
    }
  }, [form.grade, form.comment]);

  const insertFeedback = () => {
    if (analysis.status !== "ready") return;
    form.setComment(analysis.result.feedbackDraft);
    setInserted(true);
  };

  const applySuggestion = () => {
    if (analysis.status !== "ready") return;
    checkDismissed.current = true;
    form.setGrade(analysis.result.suggestedTotal);
    setCheck(null);
  };

  const align = (a: DriftAlert) => {
    checkDismissed.current = true;
    form.setGrade(a.recommendedPoints);
    setAlert(null);
    setStats((s) => ({ ...s, alertsAligned: s.alertsAligned + 1 }));
    if (target) void api.aligned(target.assignmentId).catch(() => undefined);
  };

  const keep = (a: DriftAlert) => {
    setAlert(null);
    if (target) void api.override(target.assignmentId, a.currentDecisionId, a.priorDecisionId).catch(() => undefined);
  };

  /** Approve the rubric-referenced grade and drop in the feedback. Still a draft until Submit. */
  const approveCheck = (c: ScoreCheck) => {
    checkDismissed.current = true;
    form.setGrade(c.suggestedPoints);
    insertFeedback();
    setCheck(null);
    setStats((s) => ({ ...s, checksApproved: s.checksApproved + 1 }));
    if (target) void api.checkApproved(target.assignmentId).catch(() => undefined);
  };

  const dismissCheck = () => {
    checkDismissed.current = true;
    setCheck(null);
  };

  const openTab = (t: Tab) => {
    setTab(t);
    if (t === "session" && target) void refreshSession(target.assignmentId);
  };

  const submitted = target ? latestByAnswer(decisions).get(target.answer.id) ?? null : null;
  const unsubmitted = form.grade !== null && (submitted === null || submitted.points !== form.grade || submitted.comment !== form.comment);
  const mode: Mode = offline ? "offline" : health?.analyzer ?? "unknown";

  return {
    analysis,
    inserted,
    alert,
    check,
    alertHistory,
    decisions,
    stats,
    tab,
    mode,
    health,
    recording,
    submitted,
    unsubmitted,
    pending: (alert ? 1 : 0) + (check ? 1 : 0),
    retry: () => target && analyze(target),
    submit,
    insertFeedback,
    applySuggestion,
    align,
    keep,
    approveCheck,
    dismissCheck,
    openTab,
    refreshSession,
  };
}
