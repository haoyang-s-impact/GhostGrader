import { finalizeAnalysis, ModelOutputSchema, type AnalysisResult, type Answer, type Assignment, type Question } from "@gg/shared";
import { AnalysisError } from "./claude";
import { buildSystemPrompt, promptCacheKey } from "./prompt";

/**
 * OpenAI-compatible chat completions: OpenRouter or OpenAI directly. Uses
 * JSON mode and validates the reply against the shared Zod schema, retrying
 * once on a malformed answer. The rubric-bound system prompt is identical to
 * the Claude path so all providers are interchangeable.
 */
export interface OpenRouterOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  /** Provider label stamped on results and used for provider-specific headers. */
  provider?: "openrouter" | "openai";
  log?: (msg: string) => void;
  fetchImpl?: typeof fetch;
}

export const PROVIDER_BASE_URLS = {
  openrouter: "https://openrouter.ai/api/v1",
  openai: "https://api.openai.com/v1",
} as const;

const JSON_SHAPE = `Respond with a single JSON object and nothing else, shaped exactly like:
{
  "criteria": [
    { "criterionId": "<id from the rubric>", "level": "<one band level for that criterion>", "evidence": ["<verbatim quote>", "..."], "missingConcepts": ["<allowed tag>", "..."], "confidence": 0.0 }
  ],
  "summary": "<one sentence for the teacher explaining the overall judgment>",
  "feedbackDraft": "<two to four sentences addressed to the student>"
}`;

export type JsonChat = (system: string, user: string) => Promise<string>;

/**
 * One JSON-mode chat completion against an OpenAI-compatible endpoint.
 * Returns the raw content string (fences stripped); callers validate it.
 * Throws AnalysisError with `retryable` set from the HTTP status.
 */
export function createJsonChat(opts: OpenRouterOptions): JsonChat {
  const provider = opts.provider ?? "openrouter";
  const baseUrl = (opts.baseUrl ?? PROVIDER_BASE_URLS[provider]).replace(/\/$/, "");
  const doFetch = opts.fetchImpl ?? fetch;
  return async (system, user) => {
    const res = await doFetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${opts.apiKey}`,
        "content-type": "application/json",
        ...(provider === "openrouter" ? { "http-referer": "https://github.com/onrbzkrt/GhostGrader", "x-title": "Ghost Grader" } : {}),
      },
      body: JSON.stringify({
        model: opts.model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new AnalysisError(`${provider === "openai" ? "OpenAI" : "OpenRouter"} ${res.status}: ${text.slice(0, 200)}`, res.status === 429 || res.status >= 500);
    }
    const body = (await res.json()) as {
      choices?: { message?: { content?: string | null; refusal?: string | null } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
    };
    const choice = body.choices?.[0];
    opts.log?.(`[${provider}] usage prompt=${body.usage?.prompt_tokens ?? "?"} completion=${body.usage?.completion_tokens ?? "?"} cost=${body.usage?.cost ?? "?"}`);
    if (choice?.message?.refusal) throw new AnalysisError("The model declined the request.", false);
    const content = choice?.message?.content;
    if (!content) throw new AnalysisError("The model returned an empty reply.", true);
    return stripFences(content);
  };
}

export function createOpenRouterAnalyzer(opts: OpenRouterOptions) {
  const provider = opts.provider ?? "openrouter";
  const chat = createJsonChat(opts);
  const systemCache = new Map<string, string>();

  async function once(answer: Answer, assignment: Assignment, question: Question): Promise<AnalysisResult> {
    const cacheKey = promptCacheKey(assignment, question);
    let system = systemCache.get(cacheKey);
    if (!system) {
      system = `${buildSystemPrompt(assignment, question)}\n\n# Output format\n${JSON_SHAPE}`;
      systemCache.set(cacheKey, system);
    }
    const content = await chat(system, `Student: ${answer.studentName}\n\nResponse:\n${answer.text}`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new AnalysisError("The model returned output that was not valid JSON.", true);
    }
    const out = ModelOutputSchema.safeParse(parsed);
    if (!out.success) throw new AnalysisError("The model returned output that did not match the schema.", true);
    return { ...finalizeAnalysis(answer.id, question, out.data), provider };
  }

  return async function analyze(answer: Answer, assignment: Assignment, question: Question): Promise<AnalysisResult> {
    try {
      return await once(answer, assignment, question);
    } catch (err) {
      if (err instanceof AnalysisError && !err.retryable) throw err;
      return await once(answer, assignment, question);
    }
  };
}

function stripFences(s: string): string {
  const m = s.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1]! : s;
}

/** OpenAI directly, same protocol. */
export function createOpenAIAnalyzer(opts: Omit<OpenRouterOptions, "provider">) {
  return createOpenRouterAnalyzer({ ...opts, provider: "openai" });
}
