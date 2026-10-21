import { z } from "zod";
import { callAi, type SelectedAi } from "./ai-provider.ts";
import { extractionSchema, evaluationSchema, catalog, criteriaText, validateExtraction, validateEvaluation, toReferral, type Extraction } from "./analysis-contract.ts";
import { extractionPrompt, evaluationPrompt } from "./prompts.ts";
import { maxVisionPages } from "../../shared/ai.ts";
import { AnalysisFailure } from "./claude.ts";

export const visionInputSchema = z.object({
  pages: z.array(z.string().max(2 * 1024 * 1024).regex(/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/)).min(1).max(maxVisionPages),
  fileName: z.string().max(200).optional(), patientName: z.string().max(200).optional(),
});
const pageSchema = extractionSchema.extend({ sections: extractionSchema.shape.sections.min(0), facts: extractionSchema.shape.facts.min(0) });
/** Never trust a vision model's page labels or IDs across independent requests. */
export function combinePages(pages: z.infer<typeof pageSchema>[]) {
  const identities = pages.map(p => p.identity_match);
  const adults = new Set(pages.map(p => p.adult_status).filter(v => v !== "uncertain"));
  const sections: z.infer<typeof pageSchema>["sections"] = [], facts: z.infer<typeof pageSchema>["facts"] = [];
  pages.forEach((page, i) => {
    const sectionIds = new Map(page.sections.map(s => [s.id, `p${i + 1}-${s.id}`]));
    for (const section of page.sections) sections.push({ ...section, id: sectionIds.get(section.id)!, pages: section.status === "missing" ? [] : [i + 1] });
    for (const fact of page.facts) facts.push({ ...fact, id: `p${i + 1}-${fact.id}`,
      section_ids: fact.section_ids.map(id => sectionIds.get(id) || `p${i + 1}-${id}`),
      evidence: fact.evidence.map(e => ({ ...e, page: i + 1 })) });
  });
  return { page_count: pages.length, sections, facts,
    identity_match: identities.includes("mismatch") ? "mismatch" : identities.includes("match") ? "match" : "uncertain",
    adult_status: adults.size === 1 ? [...adults][0] : "uncertain" };
}
export async function analyzeVision(selected: SelectedAi, pages: string[], patientName: string, fileName: string, signal: AbortSignal, send: (value: unknown) => void) {
  const readings: z.infer<typeof pageSchema>[] = [];
  for (let i = 0; i < pages.length; i++) {
    signal.throwIfAborted();
    send({ type: "progress", stage: "extracting", message: `Reading page ${i + 1} of ${pages.length} with ${selected.provider}…` });
    const reading = await callAi(selected, { model: selected.extractionModel, system: extractionPrompt +
      "\nYou are reading ONE rendered page, not the whole packet. Extract only facts visible on this page. Do not add missing placeholders for other pages. Sections/facts may be empty for blank pages. Use null for every bbox unless you can locate the quote. Return only the JSON object.",
      text: JSON.stringify({ physical_page: i + 1, total_pages: pages.length, patient_name_to_match: patientName || null }), image: pages[i], schema: pageSchema, signal });
    readings.push(pageSchema.parse(reading));
  }
  const extraction: Extraction = validateExtraction(combinePages(readings));
  // Small rule batches keep complete assessments within common model output limits.
  const rules: z.infer<typeof evaluationSchema>["rules"] = [];
  for (let start = 0; start < catalog.length; start += 15) {
    signal.throwIfAborted();
    const batch = catalog.slice(start, start + 15);
    send({ type: "progress", stage: "reviewing", message: `Reviewing criteria ${start + 1}–${Math.min(start + 15, catalog.length)} of ${catalog.length} with ${selected.provider}…` });
    const assessment = evaluationSchema.parse(await callAi(selected, { model: selected.reviewModel, schema: evaluationSchema, signal,
      system: evaluationPrompt + "\nReturn assessments ONLY for this request's requested_rule_ids; other criteria are context.",
      text: JSON.stringify({ authoritative_criteria: criteriaText, requested_rule_ids: batch.map(r => r.id), untrusted_extraction: extraction }) }));
    rules.push(...assessment.rules.filter(r => batch.some(b => b.id === r.id)));
  }
  const result = toReferral(extraction, validateEvaluation({ rules }, extraction), patientName, fileName);
  result.analysisProvider = { provider: selected.provider, extractionModel: selected.extractionModel, reviewModel: selected.reviewModel };
  result.evidence.forEach(e => { e.method = selected.provider === "cloudflare" ? "cloudflare" : "opencode"; });
  result.facts.forEach(f => { f.kind = selected.provider; });
  result.audit = result.audit.map(a => a.type === "claude_analysis" ? { ...a, type: "ai_analysis", note: `Page-image extraction and criteria review with ${selected.provider}. Citations and boxes are model-reported; coordinator confirmation required.` } : a);
  if (!result.evidence.length) throw new AnalysisFailure(502, "No readable evidence was extracted. Review the packet manually or choose a stronger vision model.");
  return result;
}
