import { useEffect, useState } from "react";
import { questionMax, rubricMax, type Assignment, type AssignmentInput, type Course, type Criterion, type Question } from "@gg/shared";
import { api } from "../api";
import { go } from "../router";

/**
 * Questions and their rubrics. Each question has its own criteria, point
 * bands, and the concept tags the AI may report as missing: the whole
 * contract Ghost Grader is bound to when it analyzes answers to that question.
 */
export function RubricEditorView({ assignmentId, courseId }: { assignmentId?: string; courseId?: string }) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [existing, setExisting] = useState<Assignment | null>(null);
  const [draft, setDraft] = useState<AssignmentInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const cs = await api.courses();
      setCourses(cs);
      if (assignmentId) {
        const a = await api.assignment(assignmentId);
        setExisting(a);
        setDraft({ courseId: a.courseId, title: a.title, learningObjectives: a.learningObjectives, questions: a.questions });
      } else {
        setDraft({ courseId: courseId ?? cs[0]?.id ?? "", title: "", learningObjectives: [], questions: [blankQuestion(1)] });
      }
    })().catch((e) => setError(e instanceof Error ? e.message : "Could not load."));
  }, [assignmentId, courseId]);

  if (!draft) return <main className="app-page">{error ? <div className="app-error">{error}</div> : <span className="app-muted">Loading…</span>}</main>;

  const update = (fn: (d: AssignmentInput) => void) =>
    setDraft((d) => {
      const next = structuredClone(d!);
      fn(next);
      return next;
    });
  const updateQuestion = (qi: number, fn: (q: Question) => void) => update((d) => fn(d.questions[qi]!));
  const updateCriterion = (qi: number, ci: number, fn: (c: Criterion) => void) => updateQuestion(qi, (q) => fn(q.rubric.criteria[ci]!));

  const save = async () => {
    setError(null);
    const input = normalize(draft);
    const local = validateLocally(input);
    if (local) return setError(local);
    setSaving(true);
    try {
      const saved = existing ? await api.updateAssignment(existing.id, input) : await api.createAssignment(input);
      go("grade", saved.id, saved.questions[0]!.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
      setSaving(false);
    }
  };

  return (
    <main className="app-page">
      <h1>{existing ? `${existing.title}: questions and rubrics` : "New assignment"}</h1>
      <p className="app-muted">Ghost Grader is bound to exactly what you define here. Concept tags are the only things the AI may report as missing for a criterion.</p>

      <section className="app-card">
        <label className="re-field">
          Course
          <select className="app-select" value={draft.courseId} onChange={(e) => update((d) => void (d.courseId = e.target.value))}>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="re-field">
          Title
          <input className="app-input" value={draft.title} data-assignment-title onChange={(e) => update((d) => void (d.title = e.target.value))} placeholder="e.g. Causes of the First World War" />
        </label>
        <label className="re-field">
          Learning objectives, one per line
          <textarea className="app-textarea" rows={2} value={draft.learningObjectives.join("\n")} onChange={(e) => update((d) => void (d.learningObjectives = e.target.value.split("\n")))} />
        </label>
      </section>

      {draft.questions.map((q, qi) => (
        <section className="re-question" key={qi} data-question-editor={qi}>
          <div className="app-row">
            <h2 style={{ margin: 0 }}>Question {qi + 1}</h2>
            <span className="app-muted">{questionMax(q)} pts</span>
            <span className="app-spacer" />
            {draft.questions.length > 1 && (
              <button className="app-btn app-btn-sm" onClick={() => update((d) => void d.questions.splice(qi, 1))}>Remove question</button>
            )}
          </div>
          <label className="re-field" style={{ marginTop: 10 }}>
            Short title
            <input className="app-input" value={q.title} onChange={(e) => updateQuestion(qi, (x) => void (x.title = e.target.value))} placeholder="e.g. Pressure and yield" />
          </label>
          <label className="re-field">
            Question given to students
            <textarea className="app-textarea" rows={3} value={q.prompt} data-question-prompt onChange={(e) => updateQuestion(qi, (x) => void (x.prompt = e.target.value))} />
          </label>
          <label className="re-field">
            Grade out of
            <input
              className="app-input re-xs"
              type="number"
              min={1}
              step={0.5}
              value={q.totalPoints ?? ""}
              placeholder={String(rubricMax(q) || "")}
              onChange={(e) => updateQuestion(qi, (x) => void (x.totalPoints = e.target.value === "" ? undefined : Number(e.target.value)))}
            />
            <span className="app-muted" style={{ fontWeight: 400 }}>Leave blank to grade out of the rubric total.</span>
          </label>

          <div className="ws-label" style={{ marginTop: 8 }}>Criteria</div>
          {q.rubric.criteria.map((c, ci) => (
            <div className="re-criterion" key={ci} data-criterion-editor>
              <div className="app-row">
                <input className="app-input" style={{ flex: 1 }} value={c.title} placeholder="Criterion title" data-c-title onChange={(e) => updateCriterion(qi, ci, (x) => void (x.title = e.target.value))} />
                <label className="app-muted">
                  Max pts{" "}
                  <input className="app-input re-xs" type="number" min={1} step={0.5} value={c.maxPoints} onChange={(e) => updateCriterion(qi, ci, (x) => void (x.maxPoints = Number(e.target.value) || 0))} />
                </label>
                <button className="app-btn app-btn-sm" title="Remove criterion" onClick={() => updateQuestion(qi, (x) => void x.rubric.criteria.splice(ci, 1))}>✕</button>
              </div>
              <textarea className="app-textarea" rows={2} style={{ marginTop: 8 }} value={c.description} placeholder="What this criterion rewards" onChange={(e) => updateCriterion(qi, ci, (x) => void (x.description = e.target.value))} />
              <label className="re-field" style={{ marginTop: 8 }}>
                Concept tags the AI may report as missing (comma separated)
                <input className="app-input" value={c.concepts.join(", ")} placeholder="e.g. thesis_statement, counterargument" data-c-concepts onChange={(e) => updateCriterion(qi, ci, (x) => void (x.concepts = e.target.value.split(",").map((s) => s.trimStart())))} />
              </label>
              <table className="re-bands">
                <thead>
                  <tr><th>Level</th><th>Points</th><th>Descriptor</th><th /></tr>
                </thead>
                <tbody>
                  {c.bands.map((b, bi) => (
                    <tr key={bi}>
                      <td><input className="app-input re-sm" value={b.level} onChange={(e) => updateCriterion(qi, ci, (x) => void (x.bands[bi]!.level = e.target.value))} /></td>
                      <td><input className="app-input re-xs" type="number" min={0} step={0.5} value={b.points} onChange={(e) => updateCriterion(qi, ci, (x) => void (x.bands[bi]!.points = Number(e.target.value) || 0))} /></td>
                      <td><input className="app-input" value={b.descriptor} placeholder="What earns this band" onChange={(e) => updateCriterion(qi, ci, (x) => void (x.bands[bi]!.descriptor = e.target.value))} /></td>
                      <td><button className="app-btn app-btn-sm" onClick={() => updateCriterion(qi, ci, (x) => void x.bands.splice(bi, 1))}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button className="app-btn app-btn-sm" onClick={() => updateCriterion(qi, ci, (x) => void x.bands.push({ level: "", points: 0, descriptor: "" }))}>+ Add band</button>
            </div>
          ))}
          <button className="app-btn app-btn-sm" onClick={() => updateQuestion(qi, (x) => void x.rubric.criteria.push(blankCriterion()))}>+ Add criterion</button>

          <div className="ws-label" style={{ marginTop: 16 }}>Anchor responses (optional)</div>
          {q.anchors.map((a, ai) => (
            <div key={ai} style={{ display: "grid", gap: 6, marginBottom: 8 }}>
              <input className="app-input" value={a.label} placeholder="Label, e.g. Exemplary anchor" onChange={(e) => updateQuestion(qi, (x) => void (x.anchors[ai]!.label = e.target.value))} />
              <textarea className="app-textarea" rows={3} value={a.text} onChange={(e) => updateQuestion(qi, (x) => void (x.anchors[ai]!.text = e.target.value))} />
              <button className="app-btn app-btn-sm" style={{ justifySelf: "start" }} onClick={() => updateQuestion(qi, (x) => void x.anchors.splice(ai, 1))}>Remove anchor</button>
            </div>
          ))}
          <button className="app-btn app-btn-sm" onClick={() => updateQuestion(qi, (x) => void x.anchors.push({ label: "", text: "" }))}>+ Add anchor</button>
        </section>
      ))}

      <button className="app-btn" onClick={() => update((d) => void d.questions.push(blankQuestion(d.questions.length + 1)))} data-add-question>
        + Add question
      </button>

      <div className="app-row re-sticky" style={{ marginTop: 16 }}>
        {error && <div className="app-error" style={{ margin: 0, flexBasis: "100%" }} data-editor-error>{error}</div>}
        <button className="app-btn app-btn-primary" disabled={saving} onClick={() => void save()} data-save-rubric>
          {existing ? "Save changes" : "Create assignment"}
        </button>
        <a className="app-btn" href="#/">Cancel</a>
      </div>
    </main>
  );
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function blankCriterion(): Criterion {
  return {
    id: "",
    title: "",
    description: "",
    maxPoints: 5,
    concepts: [],
    bands: [
      { level: "Exemplary", points: 5, descriptor: "" },
      { level: "Proficient", points: 3.5, descriptor: "" },
      { level: "Developing", points: 2, descriptor: "" },
      { level: "Beginning", points: 0, descriptor: "" },
    ],
  };
}

function blankQuestion(index: number): Question {
  return { id: uid("q"), index, title: "", prompt: "", rubric: { id: uid("rubric"), criteria: [blankCriterion()] }, anchors: [], lmsQuestionId: "" };
}

/** Trim text, slug concept tags, number questions in order, and give new criteria ids from their titles. */
function normalize(d: AssignmentInput): AssignmentInput {
  return {
    ...d,
    title: d.title.trim(),
    learningObjectives: d.learningObjectives.map((s) => s.trim()).filter(Boolean),
    questions: d.questions.map((q, i) => {
      const used = new Set<string>();
      return {
        ...q,
        index: i + 1,
        title: q.title.trim(),
        prompt: q.prompt.trim(),
        anchors: q.anchors.map((a) => ({ label: a.label.trim(), text: a.text.trim() })).filter((a) => a.text),
        rubric: {
          ...q.rubric,
          criteria: q.rubric.criteria.map((c, ci) => {
            let id = c.id || slug(c.title) || `criterion_${ci + 1}`;
            while (used.has(id)) id = `${id}_${ci + 1}`;
            used.add(id);
            return {
              ...c,
              id,
              title: c.title.trim(),
              description: c.description.trim(),
              concepts: c.concepts.map((t) => slug(t)).filter(Boolean),
              bands: c.bands.map((b) => ({ ...b, level: b.level.trim(), descriptor: b.descriptor.trim() })),
            };
          }),
        },
      };
    }),
  };
}

function validateLocally(a: AssignmentInput): string | null {
  if (!a.title) return "Give the assignment a title.";
  if (a.questions.length === 0) return "Add at least one question.";
  for (const q of a.questions) {
    const where = `Question ${q.index}`;
    if (!q.prompt) return `${where}: add the question students answer.`;
    if (q.totalPoints !== undefined && !(q.totalPoints > 0)) return `${where}: grade out of must be a positive number.`;
    if (q.rubric.criteria.length === 0) return `${where}: add at least one criterion.`;
    for (const c of q.rubric.criteria) {
      if (!c.title) return `${where}: every criterion needs a title.`;
      if (c.maxPoints <= 0) return `${where}: "${c.title}" needs a positive max score.`;
      if (c.bands.length < 2) return `${where}: "${c.title}" needs at least two bands.`;
      if (c.bands.some((b) => !b.level)) return `${where}: "${c.title}" has a band without a level name.`;
      if (!c.bands.some((b) => b.points === c.maxPoints)) return `${where}: "${c.title}" needs a band worth the full ${c.maxPoints} points.`;
      if (c.bands.some((b) => b.points > c.maxPoints || b.points < 0)) return `${where}: "${c.title}" has a band outside 0..${c.maxPoints}.`;
      if (c.concepts.length === 0) return `${where}: "${c.title}" needs at least one concept tag so the AI can explain what is missing.`;
    }
  }
  return null;
}
