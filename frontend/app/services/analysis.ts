import type { DocumentSection, Evidence, Fact, Referral, Rule } from "../types";
import type { AiSettings } from "#shared/ai";
import { maxPacketBytes } from "#shared/upload-limits";

export type AnalysisProgress = { stage: "uploading" | "extracting" | "reviewing"; message: string };

/** Provisional, unvalidated nodes streamed while Claude writes; the final `result` replaces them. */
export type AnalysisPreview =
  | { type: "section"; section: DocumentSection }
  | { type: "fact"; fact: Fact; evidence: Evidence[] }
  | { type: "criteria"; rules: Rule[] }
  | { type: "rule"; rule: Pick<Rule, "id" | "status" | "fact_ids" | "note"> }
  | { type: "reset"; stage: "extracting" | "reviewing" };

type Handlers = {
  onProgress: (progress: AnalysisProgress) => void;
  onPreview: (preview: AnalysisPreview) => void;
};
export interface AnalysisProvider {
  analyze(file: File, patientName: string, handlers: Handlers, signal?: AbortSignal): Promise<Referral>;
  /** Stored applicant: the server reads the PDF from storage and saves the validated result. */
  analyzeStored(packetId: string, patientName: string, handlers: Handlers, signal?: AbortSignal): Promise<Referral>;
}

type StreamEvent =
  | ({ type: "progress" } & AnalysisProgress)
  | AnalysisPreview
  | { type: "result"; referral: Referral; saved?: boolean }
  | { type: "error"; message: string };

/** Reads the server's newline-delimited event stream; only a final `result` is authoritative. */
async function readAnalysisStream(response: Response, { onProgress, onPreview }: Handlers): Promise<Referral> {
  if (!response.ok || !response.body) {
    const failure = await response.json().catch(() => ({}));
    throw new Error(failure.statusMessage || "Analysis failed. Please try again.");
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    buffer += value || "";
    const lines = buffer.split("\n");
    buffer = done ? "" : lines.pop()!;
    for (const line of lines.filter(l => l.trim())) {
      const event = JSON.parse(line) as StreamEvent;
      if (event.type === "progress") onProgress(event);
      else if (event.type === "error") throw new Error(event.message);
      else if (event.type === "result") {
        if (event.saved === false && response.url.includes("/applicants/")) throw new Error("Analysis finished but could not be saved. Retry before leaving this applicant.");
        return event.referral;
      }
      else onPreview(event);
    }
    if (done) throw new Error("The analysis connection closed before a result arrived. Please retry.");
  }
}

export function makeAnalysisProvider(settings: AiSettings): AnalysisProvider {
  // Capture settings for the whole job: changing the homepage never switches an in-flight provider.
  const selected = { ...settings };
  const aiHeaders = () => ({ "x-ai-provider": selected.provider, "x-ai-key": selected.apiKey.trim(), "x-ai-account": selected.accountId.trim(), "x-ai-extraction-model": selected.extractionModel.trim(), "x-ai-review-model": selected.reviewModel.trim() });
  async function images(file: File, handlers: Handlers, signal?: AbortSignal) {
    const { renderPacket } = await import("../lib/renderPacket");
    return renderPacket(file, signal, (page, total) => handlers.onProgress({ stage: "uploading", message: `Preparing page ${page} of ${total} for ${selected.provider}…` }));
  }
  return {
  async analyze(file, patientName, { onProgress, onPreview }, signal) {
    if (file.size > maxPacketBytes) throw new Error("Choose a PDF up to 50 MB.");
    // Raw PDF bytes; metadata in headers so the server skips multipart parsing (Worker CPU budget).
    if (selected.provider !== "anthropic") {
      const pages = await images(file, { onProgress, onPreview }, signal);
      const response = await fetch("/api/analyze", { method: "POST", headers: { ...aiHeaders(), "content-type": "application/json" }, signal, body: JSON.stringify({ pages, fileName: file.name, patientName }) });
      return readAnalysisStream(response, { onProgress, onPreview });
    }
    const headers: Record<string, string> = { ...aiHeaders(), "content-type": "application/pdf", "x-file-name": encodeURIComponent(file.name) };
    if (patientName.trim()) headers["x-patient-name"] = encodeURIComponent(patientName.trim());
    onProgress({ stage: "uploading", message: "Uploading the PDF…" });
    const response = await fetch("/api/analyze", { method: "POST", body: file, headers, signal });
    return readAnalysisStream(response, { onProgress, onPreview });
  },
  async analyzeStored(packetId, patientName, handlers, signal) {
    handlers.onProgress({ stage: "extracting", message: "Starting analysis of the stored PDF…" });
    let pages: string[] | undefined;
    if (selected.provider !== "anthropic") {
      const pdf = await fetch(`/api/applicants/${encodeURIComponent(packetId)}/pdf`, { signal });
      if (!pdf.ok) throw new Error("The stored PDF could not be loaded.");
      pages = await images(new File([await pdf.blob()], "packet.pdf", { type: "application/pdf" }), handlers, signal);
    }
    const response = await fetch(`/api/applicants/${encodeURIComponent(packetId)}/analyze`, {
      method: "POST", signal, headers: { ...aiHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ patientName: patientName.trim(), pages }),
    });
    return readAnalysisStream(response, handlers);
  },
  };
}
// Compatibility export for existing integrations; the app explicitly supplies its selected settings.
export const claudeProvider = makeAnalysisProvider({ provider: "anthropic", apiKey: "", accountId: "", extractionModel: "", reviewModel: "" });
