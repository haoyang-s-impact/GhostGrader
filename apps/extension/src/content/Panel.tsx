import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { checkScore, type Decision, type DriftAlert } from "@gg/shared";
import { createApi, ApiError, type Api, type PageSyncResponse, type SessionSummary } from "./api";
import { setComment } from "./bridge";
import { parseMark, toCommentHtml, writeMark, type GradingPage, type PageAttempt } from "./moodle";
import { AttemptsTab, type AnalysisState } from "./tabs/AttemptsTab";
import { ChecksTab, type PendingAlert, type PendingCheck } from "./tabs/ChecksTab";
import { SessionTab } from "./tabs/SessionTab";
import type { Settings } from "../settings";

type Tab = "attempts" | "checks" | "session";
type Mode = "claude" | "openrouter" | "openai" | "mock" | "offline" | "unknown";

const MARK_DEBOUNCE_MS = 400;
const emptyStats = { alertsRaised: 0, alertsAligned: 0, checksRaised: 0, checksApproved: 0 };

interface Props {
  page: GradingPage;
  settings: Settings;
}

/**
 * The panel beside Moodle's manual-grading form.
 *
 * Lifecycle: sync the page into the API (drafting the rubric on first
 * sight), analyze every attempt on the page, then watch the teacher. Typing a
 * mark is a draft and only drives the rubric check for that attempt. Clicking
 * Moodle's "Save and show next" is intercepted once: every mark on the page
 * becomes a Decision, the API compares each with the other students, and if
 * anything is inconsistent the save is held until the teacher aligns or keeps.
 * The second click saves through Moodle untouched.
 */
export function Panel({ page, settings }: Props) {
  const api = useMemo<Api>(() => createApi(settings), [settings]);
  const [tab, setTab] = useState<Tab>("attempts");
  const [mode, setMode] = useState<Mode>("unknown");
  const [modelName, setModelName] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [sync, setSync] = useState<PageSyncResponse | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [analyses, setAnalyses] = useState<Record<string, AnalysisState>>({});
  const [marks, setMarks] = useState<Record<string, number | null>>(() => Object.fromEntries(page.attempts.map((a) => [a.lmsId, parseMark(a.markInput.value)])));
  const [selected, setSelected] = useState<string | null>(null);
  const [checks, setChecks] = useState<PendingCheck[]>([]);
  const [alerts, setAlerts] = useState<PendingAlert[]>([]);
  const [saveHint, setSaveHint] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [session, setSession] = useState<SessionSummary>({ decisions: [], ...emptyStats });

  const syncRef = useRef<PageSyncResponse | null>(null);
  const analysesRef = useRef<Record<string, AnalysisState>>({});
  const dismissed = useRef<Set<string>>(new Set());
  const bypassSubmit = useRef(false);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  syncRef.current = sync;
  analysesRef.current = analyses;

  const attemptOf = useCallback((lmsId: string): PageAttempt | undefined => page.attempts.find((a) => a.lmsId === lmsId), [page]);

  const refreshSession = useCallback(async (assignmentId: string) => {
    try {
      setSession(await api.session(assignmentId));
    } catch {
      /* best-effort */
    }
  }, [api]);

  const analyzeOne = useCallback(
    async (s: PageSyncResponse, lmsId: string) => {
      const ids = s.answers[lmsId];
      if (!ids) return;
      setAnalyses((m) => ({ ...m, [lmsId]: { status: "loading" } }));
      try {
        const result = await api.analyze(s.assignmentId, s.questionId, ids.answerId);
        setAnalyses((m) => ({ ...m, [lmsId]: { status: "ready", result } }));
        // A mark typed before the analysis landed still deserves its check.
        const mark = attemptOf(lmsId) ? parseMark(attemptOf(lmsId)!.markInput.value) : null;
        if (mark !== null) evaluateCheck(lmsId, mark, result);
      } catch (err) {
        const e = err instanceof ApiError ? err : new ApiError("Analysis failed.", true);
        setAnalyses((m) => ({ ...m, [lmsId]: { status: "error", message: e.message } }));
        if (e.status === undefined) setMode("offline");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, attemptOf],
  );

  const runSync = useCallback(async () => {
    setSyncError(null);
    try {
      const h = await api.health();
      setMode(h.analyzer as Mode);
      setModelName(h.model ?? "");
    } catch {
      setMode("offline");
      setSyncError(`Could not reach the Ghost Grader API at ${settings.apiBase}. Start it, or set the URL in the extension options.`);
      return;
    }
    try {
      const s = await api.syncPage(page.context, page.attempts);
      setSync(s);
      void refreshSession(s.assignmentId);
      for (const a of page.attempts) await analyzeOne(s, a.lmsId);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Could not sync this page.");
    }
  }, [api, page, settings.apiBase, refreshSession, analyzeOne]);

  useEffect(() => {
    void runSync();
  }, [runSync]);

  /** Rubric check for one attempt against its own analysis. Draft only; nothing is recorded. */
  function evaluateCheck(lmsId: string, mark: number | null, result?: Extract<AnalysisState, { status: "ready" }>["result"]) {
    const st = analysesRef.current[lmsId];
    const analysis = result ?? (st?.status === "ready" ? st.result : undefined);
    if (!analysis || mark === null) {
      setChecks((cs) => cs.filter((c) => c.lmsId !== lmsId));
      return;
    }
    const sc = checkScore(analysis, mark);
    if (!sc) {
      setChecks((cs) => cs.filter((c) => c.lmsId !== lmsId));
      dismissed.current.delete(lmsId); // back within range; a later breach is a new check
      return;
    }
    if (dismissed.current.has(lmsId)) return;
    setChecks((cs) => {
      const fresh = cs.some((c) => c.lmsId === lmsId);
      if (!fresh && syncRef.current) {
        const ids = syncRef.current.answers[lmsId];
        if (ids) void api.checkRaised(syncRef.current.assignmentId, ids.answerId).catch(() => undefined);
      }
      return [...cs.filter((c) => c.lmsId !== lmsId), { lmsId, check: sc }];
    });
    setTab("checks");
  }

  // Watch the mark inputs (delegated, capture, so Moodle's own handlers are unaffected).
  useEffect(() => {
    const onInput = (e: Event) => {
      const el = e.target;
      if (!(el instanceof HTMLInputElement) || !/_-mark$/.test(el.name)) return;
      const attempt = page.attempts.find((a) => a.markInput === el);
      if (!attempt) return;
      const value = parseMark(el.value);
      setMarks((m) => ({ ...m, [attempt.lmsId]: value }));
      const prev = timers.current.get(attempt.lmsId);
      if (prev) clearTimeout(prev);
      timers.current.set(
        attempt.lmsId,
        setTimeout(() => {
          timers.current.delete(attempt.lmsId);
          evaluateCheck(attempt.lmsId, value);
        }, MARK_DEBOUNCE_MS),
      );
    };
    page.form.addEventListener("input", onInput, true);
    return () => page.form.removeEventListener("input", onInput, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const commentOf = (attempt: PageAttempt): string => {
    const iframe = attempt.element.querySelector<HTMLIFrameElement>("iframe.tox-edit-area__iframe");
    const fromEditor = iframe?.contentDocument?.body?.innerText?.trim();
    if (fromEditor) return fromEditor;
    return (document.getElementById(attempt.commentEditorId) as HTMLTextAreaElement | null)?.value?.replace(/<[^>]+>/g, "").trim() ?? "";
  };

  const buildDecision = (attempt: PageAttempt, points: number): Decision | null => {
    const s = syncRef.current;
    const ids = s?.answers[attempt.lmsId];
    if (!s || !ids) return null;
    const st = analysesRef.current[attempt.lmsId];
    const ready = st?.status === "ready" ? st.result : null;
    return {
      id: `${ids.answerId}:grade`,
      assignmentId: s.assignmentId,
      questionId: s.questionId,
      answerId: ids.answerId,
      studentId: ids.studentId,
      studentIndex: ids.studentIndex,
      studentName: attempt.studentName,
      points,
      maxPoints: page.context.maxMark,
      suggestedPoints: ready ? ready.suggestedTotal : null,
      missingConcepts: ready?.missingConcepts ?? [],
      comment: commentOf(attempt),
      at: Date.now(),
    };
  };

  /** Intercept Moodle's save: record every mark on the page and compare across students first. */
  useEffect(() => {
    const onSubmit = (e: SubmitEvent) => {
      if (bypassSubmit.current) {
        bypassSubmit.current = false;
        return;
      }
      if (!syncRef.current) return; // nothing to compare against; let Moodle save
      e.preventDefault();
      e.stopImmediatePropagation();
      void (async () => {
        setSaving(true);
        setSaveHint(null);
        const found: PendingAlert[] = [];
        for (const attempt of page.attempts) {
          const mark = parseMark(attempt.markInput.value);
          if (mark === null) continue;
          const d = buildDecision(attempt, mark);
          if (!d) continue;
          try {
            const { alert } = await api.decision(d);
            if (alert) found.push({ lmsId: attempt.lmsId, alert });
          } catch {
            setMode("offline");
          }
        }
        setSaving(false);
        if (syncRef.current) void refreshSession(syncRef.current.assignmentId);
        if (found.length === 0) {
          bypassSubmit.current = true;
          page.form.requestSubmit((e.submitter as HTMLElement | null) ?? page.submitButton ?? undefined);
          return;
        }
        setAlerts(found);
        setTab("checks");
        setSaveHint(`${found.length} consistency ${found.length === 1 ? "alert" : "alerts"} before saving. Resolve each, then click Save again.`);
      })();
    };
    page.form.addEventListener("submit", onSubmit, true);
    return () => page.form.removeEventListener("submit", onSubmit, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, api]);

  const applyMark = (lmsId: string, points: number) => {
    const attempt = attemptOf(lmsId);
    if (!attempt) return;
    dismissed.current.add(lmsId);
    writeMark(attempt, points);
    setMarks((m) => ({ ...m, [lmsId]: points }));
    setChecks((cs) => cs.filter((c) => c.lmsId !== lmsId));
  };

  const insertFeedback = async (lmsId: string) => {
    const attempt = attemptOf(lmsId);
    const st = analysesRef.current[lmsId];
    if (!attempt || st?.status !== "ready") return;
    await setComment(attempt.commentEditorId, toCommentHtml(st.result.feedbackDraft));
  };

  const onUse = (lmsId: string) => {
    const st = analysesRef.current[lmsId];
    if (st?.status !== "ready") return;
    applyMark(lmsId, st.result.suggestedTotal);
    void insertFeedback(lmsId);
    setSelected(lmsId);
  };

  const onApproveCheck = (lmsId: string) => {
    const st = analysesRef.current[lmsId];
    if (st?.status !== "ready") return;
    applyMark(lmsId, st.result.suggestedTotal);
    void insertFeedback(lmsId);
    if (syncRef.current) void api.checkApproved(syncRef.current.assignmentId).catch(() => undefined);
  };

  const onDismissCheck = (lmsId: string) => {
    dismissed.current.add(lmsId);
    setChecks((cs) => cs.filter((c) => c.lmsId !== lmsId));
  };

  const resolveAlert = (p: PendingAlert) => {
    setAlerts((as) => {
      const rest = as.filter((x) => x !== p);
      if (rest.length === 0) setSaveHint("Alerts resolved. Click Save and show next again to save these marks in Moodle.");
      return rest;
    });
  };

  const onAlign = (p: PendingAlert) => {
    applyMark(p.lmsId, p.alert.recommendedPoints);
    if (syncRef.current) void api.aligned(syncRef.current.assignmentId).catch(() => undefined);
    resolveAlert(p);
  };

  const onKeep = (p: PendingAlert) => {
    if (syncRef.current) void api.override(syncRef.current.assignmentId, p.alert.currentDecisionId, p.alert.priorDecisionId).catch(() => undefined);
    resolveAlert(p);
  };

  const openTab = (t: Tab) => {
    setTab(t);
    if (t === "session" && syncRef.current) void refreshSession(syncRef.current.assignmentId);
  };

  const readyCount = Object.values(analyses).filter((a) => a.status === "ready").length;
  const state = syncError ? "error" : !sync ? "syncing" : readyCount + Object.values(analyses).filter((a) => a.status === "error").length < page.attempts.length ? "analyzing" : "ready";
  const pending = alerts.length + checks.length;
  const modeLabel = mode === "openrouter" || mode === "openai" ? modelName.split("/").pop() || mode : mode === "claude" ? "Claude" : mode === "mock" ? "Mock mode" : mode === "offline" ? "Offline" : "…";
  const rubricNote = sync ? { drafted: sync.rubricDrafted, source: sync.rubricSource, editUrl: `${settings.webBase}/#/rubric/${sync.assignmentId}` } : null;

  return (
    <div className={`gg-root ${collapsed ? "is-collapsed" : ""}`} data-gg-panel data-gg-state={state}>
      <div className="gg-header">
        <button className="gg-iconbtn" onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? "Expand Ghost Grader" : "Collapse Ghost Grader"} data-gg-toggle>
          {collapsed ? "‹" : "›"}
        </button>
        <div className="gg-ghost">👻</div>
        <div className="gg-title">Ghost Grader</div>
        <span className={`gg-chip ${mode === "mock" ? "is-mock" : mode === "offline" ? "is-offline" : ""}`} data-gg-mode={mode} title={modelName}>
          {saving ? "checking…" : modeLabel}
        </span>
      </div>
      <div className="gg-tabs" role="tablist">
        <button className={`gg-tab ${tab === "attempts" ? "is-active" : ""}`} onClick={() => openTab("attempts")} role="tab" data-gg-tab="attempts">Attempts</button>
        <button className={`gg-tab ${tab === "checks" ? "is-active" : ""}`} onClick={() => openTab("checks")} role="tab" data-gg-tab="checks">
          Checks{pending > 0 && <span className="gg-badge">{pending}</span>}
        </button>
        <button className={`gg-tab ${tab === "session" ? "is-active" : ""}`} onClick={() => openTab("session")} role="tab" data-gg-tab="session">Session</button>
      </div>
      <div className="gg-body">
        {tab === "attempts" && (
          <AttemptsTab
            context={page.context}
            attempts={page.attempts}
            analyses={analyses}
            marks={marks}
            selected={selected}
            rubricNote={rubricNote}
            syncError={syncError}
            onSelect={setSelected}
            onUse={onUse}
            onInsertFeedback={(id) => void insertFeedback(id)}
            onRetry={(id) => sync && void analyzeOne(sync, id)}
            onRetrySync={() => void runSync()}
          />
        )}
        {tab === "checks" && (
          <ChecksTab attempts={page.attempts} checks={checks} alerts={alerts} saveHint={saveHint} onApproveCheck={onApproveCheck} onDismissCheck={onDismissCheck} onAlign={onAlign} onKeep={onKeep} />
        )}
        {tab === "session" && (
          <SessionTab
            decisions={session.decisions}
            questionId={sync?.questionId ?? null}
            alertsRaised={session.alertsRaised}
            alertsAligned={session.alertsAligned}
            checksRaised={session.checksRaised}
            checksApproved={session.checksApproved}
            totalStudents={page.context.attemptsTotal || page.attempts.length}
            maxPoints={page.context.maxMark}
          />
        )}
      </div>
    </div>
  );
}
