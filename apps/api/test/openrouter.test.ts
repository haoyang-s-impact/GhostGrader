import { describe, expect, it } from "vitest";
import { assignment, submissions } from "@gg/shared";
import { createOpenAIAnalyzer, createOpenRouterAnalyzer } from "../src/openrouter";
import { selectAnalyzer } from "../src/analyzer";

const sub4 = submissions.find((s) => s.index === 4)!;

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
    expect(r.provider).toBe("openrouter");
  });

  it("talks to OpenAI directly with the same protocol and no OpenRouter headers", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: init?.headers as Record<string, string> });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(goodReply) } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await createOpenAIAnalyzer({ apiKey: "k", model: "gpt-4o-mini", fetchImpl })(sub4, assignment);
    expect(calls[0]!.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(calls[0]!.headers["x-title"]).toBeUndefined();
    expect(r.provider).toBe("openai");
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
  it("orders the chain OpenRouter, OpenAI, Claude; mock otherwise; GG_MOCK wins", () => {
    const all = selectAnalyzer({ OPENROUTER_API_KEY: "k", OPENAI_API_KEY: "o", ANTHROPIC_API_KEY: "a" });
    expect(all.mode).toBe("openrouter");
    expect(all.fallbacks).toEqual([
      { mode: "openai", model: "gpt-4o-mini" },
      { mode: "claude", model: "claude-opus-5" },
    ]);
    expect(selectAnalyzer({ OPENAI_API_KEY: "o", OPENAI_MODEL: "gpt-4.1" })).toMatchObject({ mode: "openai", model: "gpt-4.1", fallbacks: [] });
    expect(selectAnalyzer({ OPENROUTER_API_KEY: "k", OPENROUTER_MODEL: "anthropic/claude-sonnet-4.5" }).model).toBe("anthropic/claude-sonnet-4.5");
    expect(selectAnalyzer({ ANTHROPIC_API_KEY: "a" }).mode).toBe("claude");
    expect(selectAnalyzer({}).mode).toBe("mock");
    expect(selectAnalyzer({ OPENROUTER_API_KEY: "k", OPENAI_API_KEY: "o", GG_MOCK: "1" }).mode).toBe("mock");
  });

  it("falls back to OpenAI when OpenRouter fails, and reports which provider served", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      if (url.startsWith("https://openrouter.ai")) return new Response("upstream down", { status: 503 });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(goodReply) } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const realFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    try {
      const logs: string[] = [];
      const info = selectAnalyzer({ OPENROUTER_API_KEY: "k", OPENAI_API_KEY: "o" }, (m) => logs.push(m));
      const r = await info.analyze(sub4, assignment);
      expect(r.provider).toBe("openai");
      // OpenRouter is tried twice (its own retry on a 5xx), then OpenAI once.
      expect(urls.filter((u) => u.startsWith("https://openrouter.ai"))).toHaveLength(2);
      expect(urls.filter((u) => u.startsWith("https://api.openai.com"))).toHaveLength(1);
      expect(logs.some((l) => l.includes("[openrouter] failed") && l.includes("trying next provider"))).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("throws the last error when every provider fails", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("nope", { status: 401 })) as unknown as typeof fetch;
    try {
      const info = selectAnalyzer({ OPENROUTER_API_KEY: "k", OPENAI_API_KEY: "o" });
      await expect(info.analyze(sub4, assignment)).rejects.toThrow(/OpenAI 401/);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
