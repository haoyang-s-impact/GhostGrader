import { z } from "zod";
import type { Anchor, Rubric } from "@gg/shared";
import type { JsonChat } from "./openrouter";

/**
 * Draft a Ghost Grader rubric for a question that arrived from an LMS page.
 * Moodle essay questions carry "Information for graders", usually the
 * teacher's marking scheme in prose. With a JSON chat available the model
 * turns it into criteria, bands and a closed concept vocabulary; without one
 * (mock mode, Claude-only config) a deterministic parser reads "Score N:"
 * lines into bands of a single criterion. Either way the teacher can refine
 * the result in the web app's rubric editor; this is a starting point, not
 * a verdict.
 */
export interface RubricDraftInput {
  title: string;
  text: string;
  maxMark: number;
  graderInfo: string;
}

const DraftSchema = z.object({
  criteria: z
    .array(
      z.object({
        title: z.string().min(1),
        description: z.string().default(""),
        maxPoints: z.number().positive(),
        concepts: z.array(z.string().min(1)).min(1),
        bands: z.array(z.object({ level: z.string().min(1), points: z.number().min(0), descriptor: z.string().default("") })).min(2),
      }),
    )
    .min(1),
});

/**
 * Worked examples from grader notes become anchors: "Score 10: ... Examples:
 * A. / B." yields one anchor per example, labelled with its score, so the
 * analysis prompt can show the model what each band looks like in practice.
 */
export function parseExampleAnchors(graderInfo: string): Anchor[] {
  const text = graderInfo.replace(/\s+/g, " ").trim();
  const anchors: Anchor[] = [];
  const re = /Score\s+(\d+(?:[.,]\d+)?)\s*[:\-–]\s*(.*?)(?=Score\s+\d|$)/gi;
  for (const m of text.matchAll(re)) {
    const score = m[1]!.replace(",", ".");
    const examples = m[2]!.match(/Examples?:\s*(.*)$/i)?.[1];
    if (!examples) continue;
    for (const ex of examples.split(/\s+\/\s+/)) {
      const t = ex.replace(/\(([^)]*)\)\s*$/, " ($1)").trim();
      if (t) anchors.push({ label: `Example earning ${score}`, text: t });
    }
  }
  return anchors;
}

export function slugTag(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "concept";
}

const SYSTEM = `You convert a teacher's marking notes for one open-ended question into an analytic rubric that an AI grading assistant will be bound to.
Return a single JSON object shaped exactly like:
{ "criteria": [ { "title": string, "description": string, "maxPoints": number, "concepts": [string, ...], "bands": [ { "level": string, "points": number, "descriptor": string }, ... ] } ] }
Rules:
1. Use the teacher's own score levels when the notes state them (for example "Score 10 / 5 / 0"), one criterion per independently scored aspect. If the notes describe one holistic scale, return one criterion.
2. The criteria's maxPoints must add up to exactly the question's maximum mark.
3. Every criterion needs a band worth its full maxPoints and a band worth 0, ordered from highest to lowest points.
4. concepts is a short closed vocabulary of snake_case tags (2 to 5 per criterion) naming the things whose absence or error would cost points, e.g. "weather_comparison", "population_comparison", "grammar_accuracy". The assistant may only report these tags as missing.
5. Keep descriptors faithful to the notes; do not invent requirements the teacher did not state.`;

export async function draftRubric(input: RubricDraftInput, chat: JsonChat | null, log?: (m: string) => void): Promise<{ rubric: Rubric; source: "model" | "parsed" }> {
  if (chat) {
    try {
      const content = await chat(SYSTEM, `Question title: ${input.title}\nMaximum mark: ${input.maxMark}\n\nQuestion:\n${input.text}\n\nInformation for graders:\n${input.graderInfo || "(none provided)"}`);
      const parsed = DraftSchema.safeParse(JSON.parse(content));
      if (parsed.success) return { rubric: normalize(parsed.data, input.maxMark), source: "model" };
      log?.(`[rubric-draft] model output did not match the schema; using the parsed fallback`);
    } catch (err) {
      log?.(`[rubric-draft] model call failed: ${err instanceof Error ? err.message : String(err)}; using the parsed fallback`);
    }
  }
  return { rubric: parseGraderInfo(input), source: "parsed" };
}

/** Slug ids, clamp bands into range, and scale criteria so they sum to the maximum mark. */
function normalize(draft: z.infer<typeof DraftSchema>, maxMark: number): Rubric {
  const sum = draft.criteria.reduce((a, c) => a + c.maxPoints, 0);
  const factor = sum > 0 && Math.abs(sum - maxMark) > 0.01 ? maxMark / sum : 1;
  const round = (n: number) => Math.round(n * 2) / 2;
  const ids = new Set<string>();
  return {
    id: `rubric-${Date.now().toString(36)}`,
    criteria: draft.criteria.map((c, i) => {
      let id = slugTag(c.title) || `criterion_${i + 1}`;
      while (ids.has(id)) id = `${id}_${i + 1}`;
      ids.add(id);
      const maxPoints = round(c.maxPoints * factor);
      const bands = c.bands
        .map((b) => ({ level: b.level, points: Math.max(0, Math.min(maxPoints, round(b.points * factor))), descriptor: b.descriptor }))
        .sort((a, b) => b.points - a.points);
      if (!bands.some((b) => b.points === maxPoints)) bands.unshift({ level: "Full", points: maxPoints, descriptor: "Fully meets the criterion." });
      if (!bands.some((b) => b.points === 0)) bands.push({ level: "None", points: 0, descriptor: "Does not meet the criterion." });
      return { id, title: c.title, description: c.description, maxPoints, concepts: [...new Set(c.concepts.map(slugTag))], bands };
    }),
  };
}

/**
 * Deterministic fallback: "Score 10: ...", "Score 5: ...", "Score 0: ..." lines
 * become the bands of one criterion; the level names come from the scores.
 * Concept tags are generic because prose cannot be mined reliably here.
 */
export function parseGraderInfo(input: RubricDraftInput): Rubric {
  const text = input.graderInfo.replace(/\s+/g, " ").trim();
  const re = /Score\s+(\d+(?:[.,]\d+)?)\s*[:\-–]\s*(.*?)(?=Score\s+\d|$)/gi;
  const bands: { level: string; points: number; descriptor: string }[] = [];
  for (const m of text.matchAll(re)) {
    const points = Math.min(input.maxMark, Number(m[1]!.replace(",", ".")));
    const descriptor = (m[2] ?? "").replace(/Examples?:.*$/i, "").trim();
    bands.push({ level: `Score ${points}`, points, descriptor });
  }
  bands.sort((a, b) => b.points - a.points);
  if (bands.length < 2) {
    bands.splice(0, bands.length,
      { level: "Full", points: input.maxMark, descriptor: "Fully meets the marking notes." },
      { level: "Partial", points: Math.round(input.maxMark / 2 * 2) / 2, descriptor: "Partly meets the marking notes." },
      { level: "None", points: 0, descriptor: "Does not meet the marking notes." },
    );
  }
  if (!bands.some((b) => b.points === input.maxMark)) bands.unshift({ level: "Full", points: input.maxMark, descriptor: "Fully meets the marking notes." });
  if (!bands.some((b) => b.points === 0)) bands.push({ level: "None", points: 0, descriptor: "Does not meet the marking notes." });
  return {
    id: `rubric-${Date.now().toString(36)}`,
    criteria: [
      {
        id: "marking_notes",
        title: input.title.replace(/\s*\(.*?\)\s*$/, "") || "Marking notes",
        description: text.slice(0, 300),
        maxPoints: input.maxMark,
        concepts: ["accuracy", "completeness", "grammar"],
        bands,
      },
    ],
  };
}
