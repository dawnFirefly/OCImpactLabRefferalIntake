import { createError } from "h3";
import type { StoredPacket } from "../../app/types.ts";
import { maxPacketBytes } from "../../shared/upload-limits.ts";
export { maxPacketBytes } from "../../shared/upload-limits.ts";

type UploadPart = { name?: string; filename?: string; data: Uint8Array };
export type PacketBucket = {
  put(key: string, value: Uint8Array, options: { httpMetadata: { contentType: string } }):
    Promise<{ key: string; size: number; uploaded: Date } | null>;
};

/** Store original bytes only. Names and patient information never become object keys or metadata. */
export async function storePacket(bucket: PacketBucket, parts: UploadPart[]): Promise<StoredPacket> {
  const files = parts.filter(p => p.filename !== undefined);
  const file = files[0];
  if (files.length !== 1 || !file || file.name !== "pdf" || !file.filename?.toLowerCase().endsWith(".pdf") ||
      !file.data.length || !new TextDecoder("latin1").decode(file.data.subarray(0, 1024)).includes("%PDF-")) {
    throw createError({ statusCode: 400, statusMessage: "Choose exactly one valid combined PDF." });
  }
  if (file.data.length > maxPacketBytes) throw createError({ statusCode: 413, statusMessage: "Choose one PDF up to 50 MB." });
  const key = `packets/${crypto.randomUUID()}.pdf`;
  try {
    const stored = await bucket.put(key, file.data, { httpMetadata: { contentType: "application/pdf" } });
    if (!stored) throw new Error("Storage did not confirm the write");
    return { key: stored.key, size: stored.size, uploaded_at: stored.uploaded.toISOString() };
  } catch {
    throw createError({ statusCode: 502, statusMessage: "The PDF could not be saved. Please retry." });
  }
}
