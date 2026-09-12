import { groundTruth, mockAnalyze, type AnalysisResult, type Assignment, type Submission } from "@gg/shared";
import { createClaudeAnalyzer } from "./claude";

export type Analyzer = (submission: Submission, assignment: Assignment) => Promise<AnalysisResult>;

export interface AnalyzerInfo {
  mode: "claude" | "mock";
  analyze: Analyzer;
}

export function selectAnalyzer(env: NodeJS.ProcessEnv = process.env): AnalyzerInfo {
  const forceMock = env.GG_MOCK === "1" || env.GG_MOCK === "true";
  const hasKey = Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN);
  if (!forceMock && hasKey) {
    return { mode: "claude", analyze: createClaudeAnalyzer() };
  }
  return {
    mode: "mock",
    analyze: async (submission, assignment) => {
      // Small artificial latency so the panel's loading state is visible in demos.
      await new Promise((r) => setTimeout(r, env.NODE_ENV === "test" ? 0 : 350));
      return mockAnalyze(submission, assignment, groundTruth);
    },
  };
}
