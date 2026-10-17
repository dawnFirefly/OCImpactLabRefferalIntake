/** The saved Claude analysis for a stored applicant (404 until one has been run). */
export default defineEventHandler(async (event) => {
  const json = await usePacketStore(event).readAnalysis(getRouterParam(event, "id") || "");
  if (!json) throw createError({ statusCode: 404, statusMessage: "No saved analysis for this applicant." });
  setResponseHeaders(event, { "Content-Type": "application/json", "Cache-Control": "private, no-store" });
  return json;
});
