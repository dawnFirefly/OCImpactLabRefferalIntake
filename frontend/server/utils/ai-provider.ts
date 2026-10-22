import { createError, getHeader, type H3Event } from "h3";
import { z } from "zod";
import { defaultModels, type AiProvider } from "../../shared/ai.ts";
import { outputSchema } from "./analysis-contract.ts";
import { anthropicKey } from "./credentials.ts";
import { AnalysisFailure } from "./claude.ts";

export type AiBinding = { run(model: string, input: Record<string, unknown>): Promise<unknown> };
export type SelectedAi = { provider: AiProvider; apiKey: string; accountId: string; extractionModel: string; reviewModel: string; binding?: AiBinding };
const model = /^[a-zA-Z0-9@/._:-]{1,150}$/;
export function selectAi(event: H3Event): SelectedAi {
  const config = useRuntimeConfig(event);
  const env = event.context.cloudflare?.env as Record<string, unknown> | undefined;
  const serverValue = (name: string, fallback: unknown) => env === undefined ? fallback : env[name];
  const provider = getHeader(event, "x-ai-provider") || String(serverValue("NUXT_AI_PROVIDER", config.aiProvider) || "cloudflare");
  if (!["cloudflare", "anthropic", "opencode"].includes(provider)) throw createError({ statusCode: 400, statusMessage: "Unknown AI provider." });
  const kind = provider as AiProvider;
  const ownKey = getHeader(event, "x-ai-key")?.trim();
  const apiKey = ownKey || (kind === "anthropic" ? anthropicKey(config, env) : String(kind === "cloudflare" ? serverValue("NUXT_CLOUDFLARE_AI_TOKEN", config.cloudflareAiToken) || "" : serverValue("NUXT_OPENCODE_API_KEY", config.opencodeApiKey) || ""));
  if (apiKey.length > 512 || /[\r\n]/.test(apiKey)) throw createError({ statusCode: 400, statusMessage: "Invalid API key." });
  const accountId = getHeader(event, "x-ai-account")?.trim() || String(serverValue("NUXT_CLOUDFLARE_ACCOUNT_ID", config.cloudflareAccountId) || "");
  const defaults = kind === "anthropic" ? { extractionModel: config.claudeExtractionModel, reviewModel: config.claudeReviewModel } : kind === "opencode" ? { extractionModel: serverValue("NUXT_OPENCODE_EXTRACTION_MODEL", config.opencodeExtractionModel), reviewModel: serverValue("NUXT_OPENCODE_REVIEW_MODEL", config.opencodeReviewModel) } : defaultModels.cloudflare;
  const extractionModel = String(getHeader(event, "x-ai-extraction-model") || defaults.extractionModel || "");
  const reviewModel = String(getHeader(event, "x-ai-review-model") || defaults.reviewModel || "");
  if (!model.test(extractionModel) || !model.test(reviewModel)) throw createError({ statusCode: 400, statusMessage: "Choose valid extraction and review model IDs. The extraction model must support images." });
  if (kind === "cloudflare" && ![extractionModel, reviewModel].every(v => /^@cf\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+$/.test(v))) throw createError({ statusCode: 400, statusMessage: "Cloudflare model IDs must use @cf/vendor/model." });
  const binding = kind === "cloudflare" && !ownKey ? env?.AI as AiBinding | undefined : undefined;
  if (!binding && (!apiKey || (kind === "cloudflare" && !/^[a-f0-9]{32}$/i.test(accountId)))) throw createError({ statusCode: 503, statusMessage: kind === "cloudflare" ? "Workers AI is not configured. Deploy with the AI binding, or enter a Cloudflare token and account ID in AI settings." : "This provider needs an API key in AI settings or a server secret." });
  return { provider: kind, apiKey, accountId, extractionModel, reviewModel, binding };
}
export function parseModelJson(result: unknown): unknown {
  const value = result as { response?: unknown; choices?: { finish_reason?: string; message?: { content?: unknown } }[] };
  if (value?.choices?.[0]?.finish_reason && value.choices[0].finish_reason !== "stop") throw new AnalysisFailure(502, "The model returned an incomplete result. Choose a model with a larger output limit.");
  const raw = value?.response ?? value?.choices?.[0]?.message?.content;
  if (raw && typeof raw === "object") return raw;
  if (typeof raw !== "string") throw new AnalysisFailure(502, "The model returned no structured result.");
  try { return JSON.parse(raw.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "")); }
  catch { throw new AnalysisFailure(502, "The model returned invalid JSON. No partial result was saved."); }
}
export async function callAi(selected: SelectedAi, input: { model: string; system: string; text: string; schema: z.ZodType; image?: string; signal?: AbortSignal }, transport: typeof fetch = fetch): Promise<unknown> {
  input.signal?.throwIfAborted();
  const schema = outputSchema(input.schema);
  const messages = [{ role: "system", content: input.system + "\nReturn only JSON matching this schema: " + JSON.stringify(schema) }, { role: "user", content: input.text }];
  try {
    if (selected.provider === "cloudflare") {
      const request = { messages, ...(input.image ? { image: input.image } : { response_format: { type: "json_schema", json_schema: schema } }), max_tokens: input.image ? 4096 : 8192, temperature: 0.1 };
      // Binding requests do not accept AbortSignal. Check cancellation before and after inference.
      if (selected.binding) {
        const result = await selected.binding.run(input.model, request);
        input.signal?.throwIfAborted();
        return parseModelJson(result);
      }
      const response = await transport(`https://api.cloudflare.com/client/v4/accounts/${selected.accountId}/ai/run/${input.model}`, {
        method: "POST", headers: { Authorization: `Bearer ${selected.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(request), signal: input.signal,
      });
      if (!response.ok) throw new AnalysisFailure(response.status === 429 ? 429 : 502, "Cloudflare rejected the request. Check credentials, model availability/license, credits, and input limits.");
      const body = await response.json() as { success?: boolean; result?: unknown };
      if (body.success === false) throw new AnalysisFailure(502, "Workers AI could not complete the request. Check the model and account configuration.");
      return parseModelJson(body.result);
    }
    const response = await transport("https://opencode.ai/inference/openai/v1/chat/completions", {
      method: "POST", headers: { Authorization: `Bearer ${selected.apiKey}`, "Content-Type": "application/json" }, signal: input.signal,
      body: JSON.stringify({ model: input.model, max_tokens: input.image ? 4096 : 8192, temperature: 0.1,
        messages: [messages[0], { role: "user", content: input.image ? [{ type: "text", text: input.text }, { type: "image_url", image_url: { url: input.image } }] : input.text }] }),
    });
    if (!response.ok) throw new AnalysisFailure(response.status === 429 ? 429 : 502, "OpenCode rejected the request. Check your key, balance, and a chat-completions model supporting images for extraction.");
    return parseModelJson(await response.json());
  } catch (error) {
    if (input.signal?.aborted) throw error;
    if (error instanceof AnalysisFailure) throw error;
    throw new AnalysisFailure(502, "The selected AI provider could not be reached. No partial result was applied.");
  }
}
