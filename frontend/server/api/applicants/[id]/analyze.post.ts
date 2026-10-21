import { streamAnalysis } from "../../../utils/run-analysis";
import { selectAi } from "../../../utils/ai-provider";
import { visionInputSchema } from "../../../utils/vision-analysis";
import { maxVisionBody } from "../../../../shared/ai";
export default defineEventHandler(async event => {
  const selected = selectAi(event);
  const id = getRouterParam(event, "id") || "";
  const store = usePacketStore(event);
  const packet = (await store.list()).find(p => p.id === id);
  if (!packet) throw createError({ statusCode: 404, statusMessage: "Applicant not found." });
  if (packet.storage === "google_drive") throw createError({ statusCode: 503, statusMessage: "Saved reviews require R2 or local storage." });
  const workspace = await useWorkspaceStore(event).read(id);
  const previousJson = workspace ? undefined : await store.readAnalysis(id);
  const previous = workspace?.value.referral || (previousJson ? JSON.parse(previousJson) : undefined);
  if (previous?.audit.some((a: { type: string }) => ["fact_review", "rule_review"].includes(a.type))) throw createError({ statusCode: 409, statusMessage: "This applicant has coordinator edits. Add a separate applicant to reanalyze without replacing the saved review." });
  await assertBodySize(event, maxVisionBody);
  const body = await readBody(event);
  const patientName = typeof body?.patientName === "string" ? body.patientName.trim().slice(0, 200) : "";
  let pages: string[] | undefined, pdf: Uint8Array | undefined;
  if (selected.provider === "anthropic") {
    const stored = await store.read(id);
    if (!stored) throw createError({ statusCode: 404, statusMessage: "The stored PDF is missing." });
    pdf = Buffer.isBuffer(stored) ? stored : new Uint8Array(await new Response(stored).arrayBuffer());
  } else {
    const parsed = visionInputSchema.safeParse(body);
    if (!parsed.success) throw createError({ statusCode: 400, statusMessage: "Choose up to 60 valid rendered PDF pages (24 MB total)." });
    pages = parsed.data.pages;
  }
  return streamAnalysis(event, { pdf, pages, fileName: packet.fileName, patientName,
    onResult: async referral => {
      if (!(await store.list()).some(p => p.id === id)) throw new Error("Applicant deleted");
      referral.id = `stored-${id}`;
      referral.title = packet.name;
      referral.revision = (workspace?.value.revision || 0) + 1;
      await useWorkspaceStore(event).write(id, referral, workspace?.value.revision || 0);
      const rec = referral.recommendation;
      if (!await store.saveAnalysis(id, JSON.stringify(referral), { analyzedAt: new Date().toISOString(), outcome: rec?.outcome ?? null, stage: rec?.stage ?? null, recommendation: rec?.status ?? null })) throw new Error("Analysis not saved");
    },
  });
});
