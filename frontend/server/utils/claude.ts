import Anthropic from "@anthropic-ai/sdk";
import { outputSchema } from "./analysis-contract.ts";
import type { z } from "zod";

export class AnalysisFailure extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export type ClaudeRequest = {
  apiKey: string; model: string; effort?: "low" | "medium" | "high" | "xhigh" | "max";
  schema: z.ZodType; system: string; content: Anthropic.Beta.BetaContentBlockParam[];
  signal?: AbortSignal; transport?: typeof fetch;
  /** Structured-output text as it streams. `onRestart` fires when a new text block begins (e.g. after a fallback). */
  onText?: (delta: string) => void; onRestart?: () => void;
};

/** One streamed structured-output request. Streaming avoids HTTP timeouts on long scanned packets. */
export async function callClaude({ apiKey, model, effort = "high", schema, system, content, signal, transport, onText, onRestart }: ClaudeRequest): Promise<unknown> {
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 15 * 60 * 1000, ...(transport ? { fetch: transport } : {}) });
  let message: Anthropic.Beta.BetaMessage;
  try {
    const stream = client.beta.messages.stream({
      model, max_tokens: 64000, system,
      // Server-side fallback reruns a policy-declined request on a suitable model in the same call.
      // Not offered for Haiku models.
      ...(model.includes("haiku") ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }),
      thinking: { type: "adaptive" },
      output_config: { effort, format: { type: "json_schema", schema: outputSchema(schema) } },
      messages: [{ role: "user", content }],
    }, { signal });
    let textBlocks = 0;
    stream.on("streamEvent", (event) => {
      if (event.type === "content_block_start" && event.content_block.type === "text" && textBlocks++ > 0) onRestart?.();
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") onText?.(event.delta.text);
    });
    message = await stream.finalMessage();
  } catch (error) {
    // Do not echo provider bodies: they may include document contents or credentials.
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError)
      throw new AnalysisFailure(503, "Claude credentials were rejected. Check the server environment key.");
    if (error instanceof Anthropic.RateLimitError)
      throw new AnalysisFailure(429, "Claude is rate limited or out of credits. Try again later.");
    if (error instanceof Anthropic.APIConnectionTimeoutError || error instanceof Anthropic.APIUserAbortError)
      throw new AnalysisFailure(504, "Claude did not finish in time. You can retry the analysis.");
    if (error instanceof Anthropic.BadRequestError)
      throw new AnalysisFailure(502, "Claude could not process this PDF. Check the model configuration, PDF size, and page limits.");
    throw new AnalysisFailure(502, "Claude could not be reached. Check the network and try again.");
  }
  if (message.stop_reason === "refusal") throw new AnalysisFailure(502, "Claude declined to analyze this PDF. Review it manually.");
  if (message.stop_reason !== "end_turn") throw new AnalysisFailure(502, "Claude returned an incomplete analysis. No partial result was applied.");
  // After a fallback switch, only the serving model's text is the answer.
  const switchAt = message.content.map(b => b.type).lastIndexOf("fallback");
  const text = message.content.slice(switchAt + 1).filter(b => b.type === "text").map(b => b.text).join("");
  try { return JSON.parse(text); }
  catch { throw new AnalysisFailure(502, "Claude returned an invalid analysis. No result was applied."); }
}
