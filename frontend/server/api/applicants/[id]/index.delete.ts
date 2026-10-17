export default defineEventHandler(async (event) => {
  const removed = await usePacketStore().remove(getRouterParam(event, "id") || "");
  if (!removed) throw createError({ statusCode: 404, statusMessage: "Applicant not found." });
  return { removed: true };
});
