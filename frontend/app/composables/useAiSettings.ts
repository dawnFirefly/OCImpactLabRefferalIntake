import { defaultModels, type AiSettings } from "#shared/ai";
/** Memory-only: keys are never written to localStorage, cookies, or applicant data. */
export function useAiSettings() {
  return useState<AiSettings>("ai-settings", () => ({ provider: "cloudflare", apiKey: "", accountId: "", ...defaultModels.cloudflare }));
}
