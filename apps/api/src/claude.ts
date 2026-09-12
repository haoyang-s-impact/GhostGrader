import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ModelOutputSchema, type AnalysisResult, type Assignment, type Submission } from "@gg/shared";
import { buildSystemPrompt } from "./prompt";

export const MODEL = "claude-opus-5";

export class AnalysisError extends Error {
  constructor(message: string, public readonly retryable: boolean) {
    super(message);
  }
}

export interface ClaudeAnalyzerOptions {
  client?: Anthropic;
  /** Verbose usage logging, used by the analyze-all script to confirm caching. */
  log?: (msg: string) => void;
}

export function createClaudeAnalyzer(opts: ClaudeAnalyzerOptions = {}) {
  const client = opts.client ?? new Anthropic();
  const systemCache = new Map<string, string>();

  async function once(submission: Submission, assignment: Assignment): Promise<AnalysisResult> {
    let system = systemCache.get(assignment.id);
    if (!system) {
      system = buildSystemPrompt(assignment);
      systemCache.set(assignment.id, system);
    }
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: `Student: ${submission.studentName}\n\nResponse:\n${submission.text}`,
        },
      ],
      output_config: { format: zodOutputFormat(ModelOutputSchema) },
    });
    opts.log?.(
      `usage input=${response.usage.input_tokens} cache_write=${response.usage.cache_creation_input_tokens ?? 0} cache_read=${response.usage.cache_read_input_tokens ?? 0} output=${response.usage.output_tokens}`,
    );
    if (response.stop_reason === "refusal") {
      throw new AnalysisError("The model declined to analyze this submission.", false);
    }
    if (!response.parsed_output) {
      throw new AnalysisError("The model returned output that did not match the schema.", true);
    }
    return { submissionId: submission.id, ...response.parsed_output };
  }

  return async function analyze(submission: Submission, assignment: Assignment): Promise<AnalysisResult> {
    try {
      return await once(submission, assignment);
    } catch (err) {
      if (err instanceof AnalysisError && !err.retryable) throw err;
      if (err instanceof Anthropic.APIError && err.status && err.status < 500 && err.status !== 429) throw err;
      // One retry for parse failures, rate limits, and server errors.
      return await once(submission, assignment);
    }
  };
}
