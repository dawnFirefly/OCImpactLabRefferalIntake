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
  // The browser sends the raw PDF bytes (no multipart parsing: cheaper on the Worker's CPU budget).
  if (!getHeader(event, "content-type")?.startsWith("application/pdf")) throw createError({ statusCode: 415, statusMessage: "Send one PDF file." });
  const decode = (value: string | undefined) => { try { return decodeURIComponent(value || "").trim(); } catch { return ""; } };
  const fileName = decode(getHeader(event, "x-file-name")).replace(/[\u0000-\u001f]/g, "").slice(0, 200) || "applicant.pdf";
  // Optional: without a name, Claude reads the patient's name from the PDF and identity is not cross-checked.
  const patientName = decode(getHeader(event, "x-patient-name"));
  if (patientName.length > 200) throw createError({ statusCode: 400, statusMessage: "The patient's name must be up to 200 characters." });
  const body = await readRawBody(event, false);
  const data = body ? new Uint8Array(body) : new Uint8Array();
  const signature = new TextDecoder().decode(data.subarray(0, 1024));
  if (!fileName.toLowerCase().endsWith(".pdf") || !data.length || data.length > maxBytes || !signature.includes("%PDF-")) {
    throw createError({ statusCode: 400, statusMessage: "Choose exactly one valid combined PDF up to 50 MB." });
  }
  return streamAnalysis(event, { pdf: data, fileName, patientName });
});
