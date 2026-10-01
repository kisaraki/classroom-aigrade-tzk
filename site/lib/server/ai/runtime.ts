import { env } from "cloudflare:workers";
import { authService } from "../auth/runtime.ts";
import { createAIProvider, AIProviderError } from "./provider.ts";
import { AISettingsService, readAISettings } from "./settings.ts";
import { handleAISettingsRequest, aiHttpError } from "./http.ts";
import { AIJobService } from "./jobs.ts";
import { handleAIJobRequest } from "./jobs-http.ts";
/** Phase 12 jobs must authorize and validate their source versions before calling. */
export async function configuredAIProvider() {
  if (!env.DB) throw new AIProviderError("AI_CONFIGURATION_INVALID");
  const settings = await readAISettings(env.DB);
  if (!settings.configuration)
    throw new AIProviderError("AI_CONFIGURATION_INVALID");
  return {
    settingsVersion: settings.version,
    provider: createAIProvider(settings.configuration, {
      secrets: {
        OPENAI_API_KEY: env.OPENAI_API_KEY,
        GEMINI_API_KEY: env.GEMINI_API_KEY,
      },
    }),
  };
}
export async function aiSettingsRoute(request: Request) {
  try {
    if (!env.DB) throw new Error("AI_UNAVAILABLE");
    return await handleAISettingsRequest(request, {
      auth: authService(request),
      settings: new AISettingsService({ db: env.DB }),
    });
  } catch (error) {
    return aiHttpError(error);
  }
}
export function aiJobService() {
  if (!env.DB) throw new AIProviderError("AI_CONFIGURATION_INVALID");
  return new AIJobService({
    db: env.DB,
    provider: (configuration) =>
      createAIProvider(configuration, {
        secrets: {
          OPENAI_API_KEY: env.OPENAI_API_KEY,
          GEMINI_API_KEY: env.GEMINI_API_KEY,
        },
      }),
  });
}
export async function aiJobsRoute(request: Request) {
  try {
    return await handleAIJobRequest(request, {
      auth: authService(request),
      jobs: aiJobService(),
    });
  } catch (error) {
    return aiHttpError(error);
  }
}
