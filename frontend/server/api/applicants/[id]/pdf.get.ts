export default defineEventHandler(async (event) => {
  const bytes = await usePacketStore(event).read(getRouterParam(event, "id") || "");
  if (!bytes) throw createError({ statusCode: 404, statusMessage: "PDF not found." });
  setResponseHeaders(event, {
    "Content-Type": "application/pdf",
    "Content-Disposition": "inline",
    "Cache-Control": "private, no-store",
  });
  return bytes;
});
