import type { H3Event } from "h3";
import { z } from "zod";
import type { Referral } from "../../app/types";
import { extractionSchema, evaluationSchema, sectionSchema, factSchema, flattenFact, catalog, validateExtraction, validateEvaluation, toReferral, criteriaText, documentId } from "./analysis-contract";
import { TopLevelArrayItems } from "./stream-json";
import { callClaude, uploadPdf, deletePdf, AnalysisFailure } from "./claude";
import { extractionPrompt, evaluationPrompt } from "./prompts";
import { anthropicKey } from "./credentials";

/**
 * One analysis at a time per server instance. On Cloudflare Workers a killed invocation (e.g. Error 1102)
 * never runs `finally`, so the lock also expires on its own instead of blocking every later upload.
 */
const lockMs = 4 * 60 * 1000;
let busyUntil = 0;

/** A data-free validation reason: our own rule names or schema paths, never document values. */
function validationReason(error: unknown) {
  if (error instanceof z.ZodError) return `schema: ${[...new Set(error.issues.map(i => `${i.path.filter(p => typeof p === "string").join(".")} ${i.code}`))].slice(0, 3).join("; ")}`;
  return error instanceof Error && /^[A-Za-z ]{3,60}$/.test(error.message) ? error.message : "unknown";
}

/**
 * Two-pass Claude analysis of one PDF, streamed as newline-delimited JSON: progress, provisional
 * `section`/`fact`/`criteria`/`rule` preview events, then exactly one validated `result` or an `error`.
 * `onResult` (stored applicants) persists the validated referral before the result is sent.
 */
export function streamAnalysis(event: H3Event, input: { pdf: Uint8Array; fileName: string; patientName: string; onResult?: (referral: Referral) => Promise<void> }) {
  const { pdf, fileName, patientName, onResult } = input;
  const config = useRuntimeConfig(event);
  const apiKey = anthropicKey(config, event.context.cloudflare?.env);
  if (!apiKey) throw createError({ statusCode: 503, statusMessage: "Claude is not configured. Set the server-only NUXT_ANTHROPIC_API_KEY secret." });
  if (Date.now() < busyUntil) throw createError({ statusCode: 429, statusMessage: "Another analysis is running. Please wait and try again." });
  busyUntil = Date.now() + lockMs;
  const release = () => { busyUntil = 0; };
  // Stop paying for Claude work when the coordinator cancels or closes the tab.
  const abort = new AbortController();
  event.node.res.on("close", () => { if (!event.node.res.writableFinished) abort.abort(); });
  const { claudeExtractionModel: extractionModel, claudeReviewModel: reviewModel } = config;
  setResponseHeader(event, "Content-Type", "application/x-ndjson; charset=utf-8");
  return new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => controller.enqueue(new TextEncoder().encode(`${JSON.stringify(payload)}\n`));
      let uploadedFileId: string | null = null;
      try {
        // Always reference the PDF via the Files API: no base64 copy or multi-MB JSON body on the Worker
        // (CPU budget), and PDFs up to 50 MB fit (inline requests are capped at 32 MB). Deleted in `finally`.
        send({ type: "progress", stage: "uploading", message: "Sending the PDF to Claude…" });
        uploadedFileId = await uploadPdf(apiKey, pdf, fileName, abort.signal);
        const pdfSource = { type: "file" as const, file_id: uploadedFileId };
        send({ type: "progress", stage: "extracting", message: "Pass 1 of 2 · Claude Haiku is reading the PDF, finding forms, facts and their positions." });
        // Preview items are shape-checked only; cross-references are validated on the complete result.
        let preview = new TopLevelArrayItems(onExtractionItem);
        function onExtractionItem(key: string, value: unknown) {
          if (key === "sections") {
            const section = sectionSchema.safeParse(value);
            if (section.success) send({ type: "section", section: { ...section.data, document_id: documentId } });
          } else if (key === "facts") {
            const parsed = factSchema.safeParse(value);
            if (!parsed.success) return;
            const { fact, evidence } = flattenFact(parsed.data);
            send({ type: "fact", fact: { ...fact, original_value: fact.value, review_note: "", discrepancy: fact.note, kind: "claude", rule_ids: [] },
              evidence: evidence.map(e => ({ ...e, document_id: documentId, confidence: null, method: "claude" })) });
          }
        }
        const restart = (stage: string) => () => { preview = new TopLevelArrayItems(stage === "extracting" ? onExtractionItem : onRuleItem); send({ type: "reset", stage }); };
        const extracted = await callClaude({ apiKey, model: extractionModel, effort: "medium", schema: extractionSchema, system: extractionPrompt, signal: abort.signal,
          onText: (delta) => preview.push(delta), onRestart: restart("extracting"), content: [
          { type: "document", source: pdfSource },
          { type: "text", text: JSON.stringify(patientName ? { patient_name_to_match: patientName }
            : { patient_name_to_match: null, instruction: "No name was provided. Extract the patient's name from the packet; report identity_match as uncertain." }) },
        ] });
        const extraction = validateExtraction(extracted);
        send({ type: "progress", stage: "reviewing", message: `Pass 2 of 2 · ${extraction.facts.length} facts from ${extraction.sections.length} forms found. Claude Sonnet is linking them to each admission criterion.` });
        send({ type: "criteria", rules: catalog.map(r => ({ ...r, status: "pending", fact_ids: [], note: "", human_review: r.human_review || false })) });
        const ruleSchema = evaluationSchema.shape.rules.element;
        function onRuleItem(key: string, value: unknown) {
          const rule = key === "rules" && ruleSchema.safeParse(value);
          if (rule && rule.success) send({ type: "rule", rule: rule.data });
        }
        preview = new TopLevelArrayItems(onRuleItem);
        const evaluated = await callClaude({ apiKey, model: reviewModel, effort: "high", schema: evaluationSchema, system: evaluationPrompt, signal: abort.signal,
          onText: (delta) => preview.push(delta), onRestart: restart("reviewing"), content: [
          { type: "text", text: `AUTHORITATIVE CRITERIA:\n${criteriaText}` },
          { type: "text", text: `UNTRUSTED EXTRACTED DOCUMENT DATA:\n${JSON.stringify(extraction)}` },
        ] });
        const referral = toReferral(extraction, validateEvaluation(evaluated, extraction), patientName, fileName);
        // Persist before reporting, so a stored applicant never has to be re-analyzed.
        let saved = false;
        if (onResult) {
          try { await onResult(referral); saved = true; } catch (failure) { console.error("Saving the analysis failed", failure); }
        }
        send({ type: "result", referral, saved });
      } catch (error) {
        send({ type: "error", message: error instanceof AnalysisFailure ? error.message
          : `The analysis did not pass evidence validation (${validationReason(error)}). No result was applied. Please retry or review the PDF manually.` });
      } finally {
        release();
        if (uploadedFileId) await deletePdf(apiKey, uploadedFileId);
        try { controller.close(); } catch { /* client already disconnected */ }
      }
    },
    // The browser left (navigation, Stop, closed tab): stop Claude work and free the lock.
    cancel() { abort.abort(); release(); },
  });
}
