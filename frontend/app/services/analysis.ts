import type { DocumentSection, Evidence, Fact, Referral, Rule } from "../types";
import { maxPacketBytes } from "#shared/upload-limits";

export type AnalysisProgress = { stage: "uploading" | "extracting" | "reviewing"; message: string };

/** Provisional, unvalidated nodes streamed while Claude writes; the final `result` replaces them. */
export type AnalysisPreview =
  | { type: "section"; section: DocumentSection }
  | { type: "fact"; fact: Fact; evidence: Evidence[] }
  | { type: "criteria"; rules: Rule[] }
  | { type: "rule"; rule: Pick<Rule, "id" | "status" | "fact_ids" | "note"> }
  | { type: "reset"; stage: "extracting" | "reviewing" };

export interface AnalysisProvider {
  analyze(file: File, patientName: string, handlers: {
    onProgress: (progress: AnalysisProgress) => void;
    onPreview: (preview: AnalysisPreview) => void;
  }, signal?: AbortSignal): Promise<Referral>;
}

type StreamEvent =
  | ({ type: "progress" } & AnalysisProgress)
  | AnalysisPreview
  | { type: "result"; referral: Referral }
  | { type: "error"; message: string };

/** Reads the server's newline-delimited event stream; only a final `result` is authoritative. */
export const claudeProvider: AnalysisProvider = {
  async analyze(file, patientName, { onProgress, onPreview }, signal) {
    if (file.size > maxPacketBytes) throw new Error("Choose a PDF up to 50 MB.");
    const body = new FormData();
    body.append("pdf", file);
    if (patientName.trim()) body.append("patientName", patientName.trim());
    onProgress({ stage: "uploading", message: "Sending the PDF to the local analysis server…" });
    const response = await fetch("/api/analyze", { method: "POST", body, signal });
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
        else if (event.type === "result") return event.referral;
        else onPreview(event);
      }
      if (done) throw new Error("The analysis connection closed before a result arrived. Please retry.");
    }
  },
};
