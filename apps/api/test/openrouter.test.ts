import { describe, expect, it } from "vitest";
import { assignment, submissions } from "@gg/shared";
import { createOpenRouterAnalyzer } from "../src/openrouter";
import { selectAnalyzer } from "../src/analyzer";

const goodReply = {
  criteria: assignment.rubric.criteria.map((c) => ({ criterionId: c.id, level: "Proficient", evidence: [], missingConcepts: [], confidence: 0.8 })),
  summary: "Solid response.",
  feedbackDraft: "Daniel, nice work.",
};

function fakeFetch(replies: (string | { status: number; body: string })[]) {
  const calls: { url: string; body: unknown }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body)) });
    const r = replies.shift();
    if (r === undefined) throw new Error("no more replies");
    if (typeof r !== "string") return new Response(r.body, { status: r.status });
    return new Response(JSON.stringify({ choices: [{ message: { content: r } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("OpenRouter analyzer", () => {
  const sub4 = submissions.find((s) => s.index === 4)!;

  it("sends the rubric-bound prompt in JSON mode and finalizes the reply", async () => {
    const { fetchImpl, calls } = fakeFetch([JSON.stringify(goodReply)]);
    const analyze = createOpenRouterAnalyzer({ apiKey: "k", model: "openai/gpt-4o-mini", fetchImpl });
    const r = await analyze(sub4, assignment);
    expect(calls[0]!.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const body = calls[0]!.body as { model: string; response_format: { type: string }; messages: { role: string; content: string }[] };
    expect(body.model).toBe("openai/gpt-4o-mini");
    expect(body.response_format.type).toBe("json_object");
    expect(body.messages[0]!.content).toContain("allowed missingConcepts tags: reversibility, dynamic_equilibrium, forward_reverse_rates");
    expect(body.messages[1]!.content).toContain(sub4.text.slice(0, 40));
    expect(r.suggestedTotal).toBe(21);
    expect(r.summary).toBe("Solid response.");
  });

  it("retries once on malformed JSON, then succeeds", async () => {
    const { fetchImpl, calls } = fakeFetch(["not json", "```json\n" + JSON.stringify(goodReply) + "\n```"]);
    const analyze = createOpenRouterAnalyzer({ apiKey: "k", model: "m", fetchImpl });
    const r = await analyze(sub4, assignment);
    expect(calls).toHaveLength(2);
    expect(r.criteria).toHaveLength(6);
  });

  it("surfaces a non-retryable API error", async () => {
    const { fetchImpl } = fakeFetch([{ status: 401, body: "bad key" }]);
    const analyze = createOpenRouterAnalyzer({ apiKey: "k", model: "m", fetchImpl });
    await expect(analyze(sub4, assignment)).rejects.toThrow(/OpenRouter 401/);
  });
});

describe("selectAnalyzer", () => {
  it("prefers OpenRouter when its key is set, Claude next, mock otherwise, and GG_MOCK wins", () => {
    expect(selectAnalyzer({ OPENROUTER_API_KEY: "k", ANTHROPIC_API_KEY: "a" }).mode).toBe("openrouter");
    expect(selectAnalyzer({ OPENROUTER_API_KEY: "k", OPENROUTER_MODEL: "anthropic/claude-sonnet-4.5" }).model).toBe("anthropic/claude-sonnet-4.5");
    expect(selectAnalyzer({ ANTHROPIC_API_KEY: "a" }).mode).toBe("claude");
    expect(selectAnalyzer({}).mode).toBe("mock");
    expect(selectAnalyzer({ OPENROUTER_API_KEY: "k", GG_MOCK: "1" }).mode).toBe("mock");
  });
});
