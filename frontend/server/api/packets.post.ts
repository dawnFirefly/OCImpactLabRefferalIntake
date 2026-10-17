import { requireWorkspace } from "../utils/workspace-access";
import { maxPacketBytes, storePacket, type PacketBucket } from "../utils/packet-storage";

export default defineEventHandler(async event => {
  setResponseHeader(event, "Cache-Control", "no-store");
  await requireWorkspace(event, useRuntimeConfig(event));
  const length = Number(getHeader(event, "content-length"));
  if (!Number.isFinite(length) || length <= 0 || length > maxPacketBytes + 65536) {
    throw createError({ statusCode: 413, statusMessage: "Choose one PDF up to 50 MB." });
  }
  const bucket = event.context.cloudflare?.env.REFERRAL_PDFS as PacketBucket | undefined;
  if (!bucket || typeof bucket.put !== "function") {
    throw createError({ statusCode: 503, statusMessage: "PDF storage is not configured. Use the Worker preview or configure the REFERRAL_PDFS bucket binding." });
  }
  const parts = await readMultipartFormData(event);
  const stored = await storePacket(bucket, parts || []);
  setResponseStatus(event, 201);
  return stored;
});
