export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id") || "";
  const store = usePacketStore(event);
  if (!(await store.list()).some(p => p.id === id)) throw createError({ statusCode: 404, statusMessage: "Applicant not found." });
  await useWorkspaceStore(event).remove(id);
  const removed = await usePacketStore(event).remove(getRouterParam(event, "id") || "");
  if (!removed) throw createError({ statusCode: 404, statusMessage: "Applicant not found." });
  return { removed: true };
});
