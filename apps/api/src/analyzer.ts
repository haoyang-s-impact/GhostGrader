import { groundTruth, mockAnalyze, type AnalysisResult, type Assignment, type Submission } from "@gg/shared";
import { createClaudeAnalyzer } from "./claude";
import { createOpenRouterAnalyzer } from "./openrouter";

export type Analyzer = (submission: Submission, assignment: Assignment) => Promise<AnalysisResult>;

export interface AnalyzerInfo {
  mode: "claude" | "openrouter" | "mock";
  model: string;
  analyze: Analyzer;
}

export const DEFAULT_OPENROUTER_MODEL = "openai/gpt-4o-mini";

/**
 * Provider selection, in order: GG_MOCK forces the deterministic analyzer;
 * OPENROUTER_API_KEY selects OpenRouter (OpenAI-compatible); an Anthropic
 * credential selects Claude; otherwise mock.
 */
export function selectAnalyzer(env: NodeJS.ProcessEnv = process.env, log?: (m: string) => void): AnalyzerInfo {
  const forceMock = env.GG_MOCK === "1" || env.GG_MOCK === "true";
  if (!forceMock && env.OPENROUTER_API_KEY) {
    const model = env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL;
    return { mode: "openrouter", model, analyze: createOpenRouterAnalyzer({ apiKey: env.OPENROUTER_API_KEY, model, baseUrl: env.OPENROUTER_BASE_URL, log }) };
  }
  if (!forceMock && (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN)) {
    return { mode: "claude", model: "claude-opus-5", analyze: createClaudeAnalyzer({ log }) };
  }
  return {
    mode: "mock",
    model: "mock",
    analyze: async (submission, assignment) => {
      // Small artificial latency so the panel's loading state is visible in demos.
      await new Promise((r) => setTimeout(r, env.NODE_ENV === "test" ? 0 : 350));
      return mockAnalyze(submission, assignment, groundTruth);
    },
  };
}
