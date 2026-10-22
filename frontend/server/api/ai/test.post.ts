import { z } from "zod";
import { selectAi, callAi } from "../../utils/ai-provider";
import { callClaude } from "../../utils/claude";
export default defineEventHandler(async event => {
  const selected = selectAi(event);
  const schema = z.object({ connected: z.boolean() });
  try {
    const result = selected.provider === "anthropic" ? await callClaude({ apiKey: selected.apiKey, model: selected.reviewModel, effort: "low", schema,
      system: "Return connected true.", content: [{ type: "text", text: "Connection test; no patient data." }] })
      : await callAi(selected, { model: selected.reviewModel, system: "Return connected true.", text: "Connection test; no patient data.", schema });
    if (schema.parse(result).connected !== true) throw new Error();
    return { connected: true };
  } catch { throw createError({ statusCode: 502, statusMessage: "Connection test failed. Check the provider, model, credentials, and account access." }); }
});
