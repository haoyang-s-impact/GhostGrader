import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assignment, englishAssignment, questionById, seededAssignments } from "@gg/shared";
import { buildSystemPrompt } from "../src/prompt";

describe("seeded question media", () => {
  it("points at files the web app serves", () => {
    const publicDir = fileURLToPath(new URL("../../web/public/", import.meta.url));
    const srcs = seededAssignments.flatMap((a) => a.questions.flatMap((q) => q.media ?? [])).map((m) => m.src);
    expect(srcs.length).toBeGreaterThan(0);
    for (const src of srcs) expect(existsSync(join(publicDir, src)), src).toBe(true);
  });
});

describe("buildSystemPrompt", () => {
  it("gives a listening question the clip's transcript as its stimulus, keeping the anchors authoritative", () => {
    const q = questionById(englishAssignment, "q-eng-order-barbara")!;
    const prompt = buildSystemPrompt(englishAssignment, q);
    expect(prompt).toContain("# Stimulus");
    expect(prompt).toContain("### Audio: Dialogue: Barbara and the waiter");
    expect(prompt).toContain("I'd like a mixed kebab, please.");
    expect(prompt).toContain("### Image: Menu");
    expect(prompt).toMatch(/anchor responses remain the answer key/);
    expect(prompt.indexOf("# Stimulus")).toBeLessThan(prompt.indexOf("# Rubric"));
  });

  it("says so when an audio clip has no transcript", () => {
    const q = questionById(englishAssignment, "q-eng-order-adam")!;
    const bare = { ...q, media: q.media!.map((m) => ({ ...m, transcript: undefined })) };
    expect(buildSystemPrompt(englishAssignment, bare)).toMatch(/No transcript is available; judge against the anchor responses/);
  });

  it("leaves questions without media unchanged", () => {
    const q = assignment.questions[0]!;
    const prompt = buildSystemPrompt(assignment, q);
    expect(prompt).not.toContain("# Stimulus");
    expect(prompt).toContain(`${q.prompt}\n\n# Rubric`);
  });
});
