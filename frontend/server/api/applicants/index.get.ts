export default defineEventHandler(async () => {
  return await usePacketStore().list();
});
