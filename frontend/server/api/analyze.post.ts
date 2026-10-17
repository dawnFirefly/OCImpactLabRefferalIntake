import { anthropicKey } from "../utils/credentials";
import { streamAnalysis } from "../utils/run-analysis";
import { requireWorkspace } from "../utils/workspace-access";
import { maxPacketBytes } from "../../shared/upload-limits";

const maxBytes = maxPacketBytes;

/**
 * Streams newline-delimited JSON: progress, provisional `section`/`fact`/`criteria`/`rule`
 * preview events as Claude writes them, then exactly one validated `result` or an `error`.
 * Request validation failures still use HTTP status codes before the stream starts.
 */
export default defineEventHandler(async event => {
  setResponseHeader(event, "Cache-Control", "no-store");
  const config = useRuntimeConfig(event);
  await requireWorkspace(event, config);
  const length = Number(getHeader(event, "content-length"));
  if (!Number.isFinite(length) || length <= 0 || length > maxBytes + 65536) throw createError({ statusCode: 413, statusMessage: "Choose one PDF up to 50 MB." });
  const apiKey = anthropicKey(config, event.context.cloudflare?.env);
  if (!apiKey) throw createError({ statusCode: 503, statusMessage: "Claude is not configured. Set the server-only NUXT_ANTHROPIC_API_KEY secret." });
  const parts = await readMultipartFormData(event);
  const files = parts?.filter(p => p.filename !== undefined) || [];
  const nameParts = parts?.filter(p => p.name === "patientName" && p.filename === undefined) || [];
  const file = files[0];
  const patientName = nameParts[0]?.data.toString("utf8").trim() || "";
  // Optional: without a name, Claude reads the patient's name from the PDF and identity is not cross-checked.
  if (nameParts.length > 1 || patientName.length > 200) throw createError({ statusCode: 400, statusMessage: "The patient's name must be up to 200 characters." });
  if (files.length !== 1 || !file || file.name !== "pdf" || !file.filename?.toLowerCase().endsWith(".pdf") || !file.data.length || file.data.length > maxBytes || !file.data.subarray(0, 1024).includes(Buffer.from("%PDF-"))) {
    throw createError({ statusCode: 400, statusMessage: "Choose exactly one valid combined PDF up to 50 MB." });
  }
  return streamAnalysis(event, { pdf: file.data, fileName: file.filename!, patientName });
});
