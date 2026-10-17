import { requireWorkspace } from "../../../utils/workspace-access";
import { streamAnalysis } from "../../../utils/run-analysis";

/**
 * Analyzes a stored applicant's PDF straight from storage (no browser re-upload) and saves the
 * validated result with the applicant, so it never has to be re-run. Same stream as /api/analyze.
 */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, "Cache-Control", "no-store");
  await requireWorkspace(event, useRuntimeConfig(event));
  const id = getRouterParam(event, "id") || "";
  const store = usePacketStore(event);
  const packet = (await store.list()).find((p) => p.id === id);
  if (!packet) throw createError({ statusCode: 404, statusMessage: "Applicant not found." });
  const body = await readBody<{ patientName?: unknown } | undefined>(event).catch(() => undefined);
  const patientName = typeof body?.patientName === "string" ? body.patientName.trim().slice(0, 200) : "";
  const stored = await store.read(id);
  if (!stored) throw createError({ statusCode: 404, statusMessage: "The stored PDF is missing." });
  const pdf = Buffer.isBuffer(stored) ? stored : Buffer.from(await new Response(stored).arrayBuffer());
  return streamAnalysis(event, {
    pdf, fileName: packet.fileName, patientName,
    onResult: async (referral) => {
      const rec = referral.recommendation;
      await store.saveAnalysis(id, JSON.stringify(referral), {
        analyzedAt: new Date().toISOString(), outcome: rec?.outcome ?? null, stage: rec?.stage ?? null, recommendation: rec?.status ?? null,
      });
    },
  });
});
