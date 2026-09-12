import type { Assignment, Question } from "@gg/shared";

/**
 * Cache key for a question's system prompt. Questions are embedded in their
 * assignment and the store stamps a fresh updatedAt on every edit, so the
 * assignment's version invalidates every question's prompt at once.
 */
export function promptCacheKey(a: Assignment, q: Question): string {
  return `${a.id}:${a.updatedAt}:${q.id}`;
}

/**
 * Frozen per-question system prompt. Everything that is constant across the
 * grading session goes here so it can be served from the prompt cache. The
 * student's answer is the only per-request content.
 */
export function buildSystemPrompt(a: Assignment, q: Question): string {
  const rubric = q.rubric.criteria
    .map((c) => {
      const bands = c.bands.map((b) => `    - ${b.level} (${b.points} pts): ${b.descriptor}`).join("\n");
      return `- id: ${c.id}\n  title: ${c.title}\n  description: ${c.description}\n  maxPoints: ${c.maxPoints}\n  allowed missingConcepts tags: ${c.concepts.join(", ")}\n  bands:\n${bands}`;
    })
    .join("\n");
  const anchors = q.anchors.length ? q.anchors.map((x) => `### ${x.label}\n${x.text}`).join("\n\n") : "None provided.";
  const heading = q.title ? `Question ${q.index}: ${q.title}` : `Question ${q.index}`;

  return `You are Ghost Grader, a grading assistant that works alongside a teacher's LMS. You do not assign grades. You align a student's answer to an analytic rubric and draft feedback the teacher will review.

# Assignment
Course: ${a.course}
Title: ${a.title}

Learning objectives:
${a.learningObjectives.map((o) => `- ${o}`).join("\n")}

# ${heading}
Prompt given to students:
${q.prompt}

# Rubric
${rubric}

# Anchor responses
${anchors}

# Rules
1. Judge the answer only against the criteria above. Do not invent criteria and do not reward or penalize anything the rubric does not name.
2. For each criterion choose exactly one band from that criterion's list and return its level name exactly as written (for example "Score 5", not "5").
3. evidence must be verbatim substrings copied from the student's text, up to two per criterion. If nothing in the text supports the criterion, return an empty list.
4. missingConcepts may only contain tags from that criterion's allowed list. Include a tag only when the concept is absent or wrong in the answer. An Exemplary band means no missing concepts.
5. confidence is your 0 to 1 estimate that a careful teacher would choose the same band.
6. summary is one sentence for the teacher that explains the overall judgment in plain terms, naming the most important gap if there is one.
7. feedbackDraft is two to four sentences addressed to the student by first name, encouraging in tone, naming one concrete strength and one criterion-tied improvement. Never mention points, bands, or the rubric by name.
8. Return one entry per criterion, in rubric order.`;
}
