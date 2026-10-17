import { z } from "zod";
import { extractionSchema, evaluationSchema, sectionSchema, factSchema, flattenFact, catalog, validateExtraction, validateEvaluation, toReferral, criteriaText, documentId } from "../utils/analysis-contract";
import { TopLevelArrayItems } from "../utils/stream-json";
import { callClaude, AnalysisFailure } from "../utils/claude";
import { extractionPrompt, evaluationPrompt } from "../utils/prompts";
import { anthropicKey } from "../utils/credentials";
import { requireWorkspace } from "../utils/workspace-access";
import { maxInlineAnalysisBytes } from "../../shared/upload-limits";

let busy = false;

/** A data-free validation reason: our own rule names or schema paths, never document values. */
function validationReason(error: unknown) {
  if (error instanceof z.ZodError) return `schema: ${[...new Set(error.issues.map(i => `${i.path.filter(p => typeof p === "string").join(".")} ${i.code}`))].slice(0, 3).join("; ")}`;
  return error instanceof Error && /^[A-Za-z ]{3,60}$/.test(error.message) ? error.message : "unknown";
}
const maxBytes = maxInlineAnalysisBytes;

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
  if (!Number.isFinite(length) || length <= 0 || length > maxBytes + 65536) throw createError({ statusCode: 413, statusMessage: "Choose one PDF up to 20 MB." });
  const apiKey = anthropicKey(config, event.context.cloudflare?.env);
  if (!apiKey) throw createError({ statusCode: 503, statusMessage: "Claude is not configured. Set the server-only NUXT_ANTHROPIC_API_KEY secret." });
  if (busy) throw createError({ statusCode: 429, statusMessage: "Another analysis is running. Please wait and try again." });
  const parts = await readMultipartFormData(event);
  const files = parts?.filter(p => p.filename !== undefined) || [];
  const nameParts = parts?.filter(p => p.name === "patientName" && p.filename === undefined) || [];
  const file = files[0];
  const patientName = nameParts[0]?.data.toString("utf8").trim() || "";
  // Optional: without a name, Claude reads the patient's name from the PDF and identity is not cross-checked.
  if (nameParts.length > 1 || patientName.length > 200) throw createError({ statusCode: 400, statusMessage: "The patient's name must be up to 200 characters." });
  if (files.length !== 1 || !file || file.name !== "pdf" || !file.filename?.toLowerCase().endsWith(".pdf") || !file.data.length || file.data.length > maxBytes || !file.data.subarray(0, 1024).includes(Buffer.from("%PDF-"))) {
    throw createError({ statusCode: 400, statusMessage: "Choose exactly one valid combined PDF up to 20 MB." });
  }
  busy = true;
  // Stop paying for Claude work when the coordinator cancels or closes the tab.
  const abort = new AbortController();
  event.node.res.on("close", () => { if (!event.node.res.writableFinished) abort.abort(); });
  const { claudeExtractionModel: extractionModel, claudeReviewModel: reviewModel } = config;
  setResponseHeader(event, "Content-Type", "application/x-ndjson; charset=utf-8");
  return new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => controller.enqueue(new TextEncoder().encode(`${JSON.stringify(payload)}\n`));
      try {
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
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: file.data.toString("base64") } },
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
        send({ type: "result", referral: toReferral(extraction, validateEvaluation(evaluated, extraction), patientName, file.filename!) });
      } catch (error) {
        send({ type: "error", message: error instanceof AnalysisFailure ? error.message
          : `The analysis did not pass evidence validation (${validationReason(error)}). No result was applied. Please retry or review the PDF manually.` });
      } finally {
        busy = false;
        try { controller.close(); } catch { /* client already disconnected */ }
      }
    },
    cancel() { abort.abort(); },
  });
});
