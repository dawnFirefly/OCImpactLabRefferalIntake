export type AiProvider = "cloudflare" | "anthropic" | "opencode";
export type AiSettings = { provider: AiProvider; apiKey: string; accountId: string; extractionModel: string; reviewModel: string };
export const defaultModels: Record<AiProvider, { extractionModel: string; reviewModel: string }> = {
  cloudflare: { extractionModel: "@cf/meta/llama-3.2-11b-vision-instruct", reviewModel: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" },
  anthropic: { extractionModel: "claude-haiku-5-5", reviewModel: "claude-sonnet-5-5" },
  opencode: { extractionModel: "", reviewModel: "" },
};
export const maxVisionPages = 60;
export const maxVisionBody = 24 * 1024 * 1024;
