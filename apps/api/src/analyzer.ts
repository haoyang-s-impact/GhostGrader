import { groundTruth, mockAnalyze, type AnalysisResult, type Answer, type Assignment, type Question } from "@gg/shared";
import { AnalysisError, createClaudeAnalyzer } from "./claude";
import { createJsonChat, createOpenAIAnalyzer, createOpenRouterAnalyzer, type JsonChat } from "./openrouter";

export type Analyzer = (answer: Answer, assignment: Assignment, question: Question) => Promise<AnalysisResult>;

export type ProviderMode = "openrouter" | "openai" | "claude" | "mock";

export interface ProviderInfo {
  mode: ProviderMode;
  model: string;
}

export interface AnalyzerInfo extends ProviderInfo {
  /** Providers tried, in order, when the primary fails. */
  fallbacks: ProviderInfo[];
  analyze: Analyzer;
}

export const DEFAULT_OPENROUTER_MODEL = "openai/gpt-5-mini";
export const DEFAULT_OPENAI_MODEL = "gpt-5-mini";

/**
 * Provider chain, in order: OpenRouter, OpenAI, Claude, for whichever keys
 * are set. The first is primary; the rest are fallbacks tried when a call
 * fails for any reason (outage, rate limit, refusal, bad output). GG_MOCK
 * forces the deterministic analyzer; with no keys it is the only option.
 */
export function selectAnalyzer(env: NodeJS.ProcessEnv = process.env, log?: (m: string) => void): AnalyzerInfo {
  const forceMock = env.GG_MOCK === "1" || env.GG_MOCK === "true";
  const chain: (ProviderInfo & { analyze: Analyzer })[] = [];
  if (!forceMock) {
    if (env.OPENROUTER_API_KEY) {
      const model = env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL;
      chain.push({ mode: "openrouter", model, analyze: createOpenRouterAnalyzer({ apiKey: env.OPENROUTER_API_KEY, model, baseUrl: env.OPENROUTER_BASE_URL, log }) });
    }
    if (env.OPENAI_API_KEY) {
      const model = env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
      chain.push({ mode: "openai", model, analyze: createOpenAIAnalyzer({ apiKey: env.OPENAI_API_KEY, model, baseUrl: env.OPENAI_BASE_URL, log }) });
    }
    if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) {
      chain.push({ mode: "claude", model: "claude-opus-5", analyze: async (ans, a, q) => ({ ...(await createClaudeAnalyzer({ log })(ans, a, q)), provider: "claude" }) });
    }
  }
  if (chain.length === 0) {
    return {
      mode: "mock",
      model: "mock",
      fallbacks: [],
      analyze: async (answer, assignment, question) => {
        // Small artificial latency so the panel's loading state is visible in demos.
        await new Promise((r) => setTimeout(r, env.NODE_ENV === "test" ? 0 : 350));
        return { ...mockAnalyze(answer, assignment, question, groundTruth), provider: "mock" };
      },
    };
  }
  const [primary, ...rest] = chain as [typeof chain[number], ...typeof chain];
  return {
    mode: primary.mode,
    model: primary.model,
    fallbacks: rest.map(({ mode, model }) => ({ mode, model })),
    analyze: async (answer, assignment, question) => {
      let lastError: unknown;
      for (const p of chain) {
        try {
          return await p.analyze(answer, assignment, question);
        } catch (err) {
          lastError = err;
          log?.(`[${p.mode}] failed: ${err instanceof Error ? err.message : String(err)}${p === chain[chain.length - 1] ? "" : " -> trying next provider"}`);
        }
      }
      throw lastError instanceof Error ? lastError : new AnalysisError("All providers failed.", true);
    },
  };
}

/**
 * A plain JSON chat on the first OpenAI-compatible provider that has a key
 * (OpenRouter, then OpenAI), for auxiliary tasks such as drafting a rubric
 * from a question's grader notes. Null when only Claude or nothing is
 * configured, or when GG_MOCK is set; callers fall back to a deterministic path.
 */
export function selectJsonChat(env: NodeJS.ProcessEnv = process.env, log?: (m: string) => void): JsonChat | null {
  const forceMock = env.GG_MOCK === "1" || env.GG_MOCK === "true";
  if (forceMock) return null;
  if (env.OPENROUTER_API_KEY) {
    return createJsonChat({ provider: "openrouter", apiKey: env.OPENROUTER_API_KEY, model: env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL, baseUrl: env.OPENROUTER_BASE_URL, log });
  }
  if (env.OPENAI_API_KEY) {
    return createJsonChat({ provider: "openai", apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL, baseUrl: env.OPENAI_BASE_URL, log });
  }
  return null;
}
