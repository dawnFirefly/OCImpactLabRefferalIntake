export default defineEventHandler(async (event) => {
  return await usePacketStore(event).list();
});
