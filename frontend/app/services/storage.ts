import type { StoredPacket } from "../types";

/** Only called by the explicit Save PDF action; attachments and previews do not upload. */
export async function uploadPacket(file: File, signal?: AbortSignal): Promise<StoredPacket> {
  const body = new FormData();
  body.append("pdf", file);
  const response = await fetch("/api/packets", { method: "POST", body, signal });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.statusMessage || "The PDF could not be saved. Please retry.");
  if (!/^packets\/[0-9a-f-]{36}\.pdf$/.test(result.key || "") || !Number.isSafeInteger(result.size) || result.size <= 0 ||
      typeof result.uploaded_at !== "string" || !Number.isFinite(Date.parse(result.uploaded_at))) {
    throw new Error("Storage did not return a valid confirmation. Check the bucket before retrying.");
  }
  return result;
}
