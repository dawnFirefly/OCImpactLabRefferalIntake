export default defineEventHandler(async event => {
  const id = getRouterParam(event, "id") || "";
  const packet = (await usePacketStore(event).list()).find(p => p.id === id);
  if (!packet) throw createError({ statusCode: 404, statusMessage: "Applicant not found." });
  setResponseHeader(event, "Cache-Control", "private, no-store");
  const stored = await useWorkspaceStore(event).read(id);
  if (stored) return stored.value;
  // Legacy analysis becomes revision zero until the first explicit workspace save.
  const json = await usePacketStore(event).readAnalysis(id);
  if (!json) return null;
  const referral = JSON.parse(json);
  referral.id = `stored-${id}`;
  return { schemaVersion: 1, revision: 0, updatedAt: packet.analysis?.analyzedAt || packet.uploadedAt, referral };
});
