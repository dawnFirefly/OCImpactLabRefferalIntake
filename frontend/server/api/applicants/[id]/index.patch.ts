/** Updates intake details or review status. The stored PDF is never changed here. */
export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event);
  if (!body || typeof body !== "object") throw createError({ statusCode: 400, statusMessage: "Expected a JSON body." });
  const updated = await usePacketStore().update(getRouterParam(event, "id") || "", parseIntake(body, true));
  if (!updated) throw createError({ statusCode: 404, statusMessage: "Applicant not found." });
  return updated;
});
