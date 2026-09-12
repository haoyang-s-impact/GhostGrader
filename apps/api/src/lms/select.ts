import type { LmsAdapter } from "./adapter";
import { createCanvasAdapter } from "./canvas";
import { createMockLmsAdapter } from "./mock";

/**
 * Pick the LMS adapter from the environment, the way selectAnalyzer picks the
 * LLM chain. There is no fallback chain here: a second LMS standing in for the
 * first would push grades somewhere they do not belong.
 *
 *   GG_LMS           mock (default) | canvas
 *   GG_LMS_BASE_URL  overrides the adapter's base URL
 *   GG_LMS_TOKEN     bearer token sent to the LMS
 */
export function selectLmsAdapter(env: NodeJS.ProcessEnv = process.env, log?: (m: string) => void): LmsAdapter {
  if (env.GG_LMS === "canvas") {
    return createCanvasAdapter({ baseUrl: env.GG_LMS_BASE_URL ?? "", token: env.GG_LMS_TOKEN ?? "" });
  }
  return createMockLmsAdapter({ baseUrl: env.GG_LMS_BASE_URL, apiKey: env.GG_LMS_TOKEN, log });
}
