import { parseWorkspaceReferral } from "../../../../shared/workspace";
export default defineEventHandler(async event => {
  const id = getRouterParam(event, "id") || "";
  const packet = (await usePacketStore(event).list()).find(p => p.id === id);
  if (!packet) throw createError({ statusCode: 404, statusMessage: "Applicant not found." });
  if (packet.storage === "google_drive") throw createError({ statusCode: 503, statusMessage: "Persistent reviews require R2 or local storage. Google Drive reviews are not supported." });
  await assertBodySize(event, 4 * 1024 * 1024);
  const body = await readBody(event);
  let referral;
  try {
    if (!Number.isInteger(body?.revision) || body.revision < 0) throw new Error();
    referral = parseWorkspaceReferral(body.referral, id);
  } catch { throw createError({ statusCode: 400, statusMessage: "Invalid review workspace or graph links." }); }
  setResponseHeader(event, "Cache-Control", "no-store");
  referral.revision = body.revision + 1;
  const saved = await useWorkspaceStore(event).write(id, referral, body.revision);
  if (referral.status === "analyzed") {
    const rec = referral.recommendation;
    await usePacketStore(event).saveAnalysis(id, JSON.stringify(referral), {
      analyzedAt: packet.analysis?.analyzedAt || new Date().toISOString(), outcome: rec?.outcome ?? null, stage: rec?.stage ?? null, recommendation: rec?.status ?? null,
    });
  }
  return saved;
});
