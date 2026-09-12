import { groundTruth, mockAnalyze, type AnalysisResult, type Assignment, type Submission } from "@gg/shared";
import { AnalysisError, createClaudeAnalyzer } from "./claude";
import { createOpenAIAnalyzer, createOpenRouterAnalyzer } from "./openrouter";

export type Analyzer = (submission: Submission, assignment: Assignment) => Promise<AnalysisResult>;

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

export const DEFAULT_OPENROUTER_MODEL = "openai/gpt-4o-mini";
export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

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
      chain.push({ mode: "claude", model: "claude-opus-5", analyze: async (s, a) => ({ ...(await createClaudeAnalyzer({ log })(s, a)), provider: "claude" }) });
    }
  }
  if (chain.length === 0) {
    return {
      mode: "mock",
      model: "mock",
      fallbacks: [],
      analyze: async (submission, assignment) => {
        // Small artificial latency so the panel's loading state is visible in demos.
        await new Promise((r) => setTimeout(r, env.NODE_ENV === "test" ? 0 : 350));
        return { ...mockAnalyze(submission, assignment, groundTruth), provider: "mock" };
      },
    };
  }
  const [primary, ...rest] = chain as [typeof chain[number], ...typeof chain];
  return {
    mode: primary.mode,
    model: primary.model,
    fallbacks: rest.map(({ mode, model }) => ({ mode, model })),
    analyze: async (submission, assignment) => {
      let lastError: unknown;
      for (const p of chain) {
        try {
          return await p.analyze(submission, assignment);
        } catch (err) {
          lastError = err;
          log?.(`[${p.mode}] failed: ${err instanceof Error ? err.message : String(err)}${p === chain[chain.length - 1] ? "" : " -> trying next provider"}`);
        }
      }
      throw lastError instanceof Error ? lastError : new AnalysisError("All providers failed.", true);
    },
  };
}
