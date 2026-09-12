import type { LmsAdapter } from "./adapter";
import { createCanvasAdapter } from "./canvas";

/**
 * Pick the LMS adapter from the environment. By default there is none: the
 * seeded questions and answers are already in the store, and sync routes
 * report that no LMS is configured.
 *
 *   GG_LMS           unset (no LMS) | canvas
 *   GG_LMS_BASE_URL  the LMS API base URL
 *   GG_LMS_TOKEN     bearer token sent to the LMS
 */
export function selectLmsAdapter(env: NodeJS.ProcessEnv = process.env): LmsAdapter | null {
  if (env.GG_LMS === "canvas") {
    return createCanvasAdapter({ baseUrl: env.GG_LMS_BASE_URL ?? "", token: env.GG_LMS_TOKEN ?? "" });
  }
  return null;
}
