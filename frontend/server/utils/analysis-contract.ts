import { z } from "zod";
import type { Referral, Recommendation, Rule } from "../../app/types.ts";
import { catalog, criteriaPrecedence, criteriaSource, evaluateTree, outcomeLabels, type Criterion } from "../../shared/decision-tree.ts";
export { catalog, criteriaText, type Criterion } from "../../shared/decision-tree.ts";

const id = z.string().min(1).max(120);
const text = z.string().max(6000);
const ids = z.array(id).max(500);
/**
 * Model-facing extraction. Property order is generation order: sections, then
 * self-contained facts (evidence inline), so the server can stream each node as it completes.
 */
export const sectionSchema = z.object({
  id, title: text, category: text,
  pages: z.array(z.number().int()).max(1000),
  status: z.enum(["found", "missing", "uncertain"]),
}).strict();
export const factSchema = z.object({
  id, key: id, label: text, group: text, value: text, unit: text,
  section_ids: ids,
  evidence: z.array(z.object({
    // Lower bounds are not sent to the model (see outputSchema); repairs drop empty or page-0 citations.
    page: z.number().int(), quote: z.string().max(6000),
    /** Approximate [left, top, right, bottom] as 0–1 fractions of the displayed page; null when not located. */
    bbox: z.array(z.number()).nullable(),
  }).strict()).max(50),
  status: z.enum(["found", "missing", "uncertain", "conflicting", "redacted"]),
  note: text,
}).strict();
export const extractionSchema = z.object({
  page_count: z.number().int().min(1).max(1000),
  sections: z.array(sectionSchema).min(1).max(150),
  facts: z.array(factSchema).min(1).max(500),
  identity_match: z.enum(["match", "uncertain", "mismatch"]),
  adult_status: z.enum(["adult", "child", "uncertain"]),
}).strict();
type ModelFact = z.infer<typeof factSchema>;
type FlatFact = Omit<ModelFact, "evidence"> & { evidence_ids: string[] };
type Box = [number, number, number, number];
type FlatEvidence = { id: string; page: number; quote: string; bbox: Box | null };
/** Keep a model-located box only if it is a sane, non-degenerate normalized rectangle. */
export function sanitizeBox(box: number[] | null): Box | null {
  if (!box || box.length !== 4 || !box.every(Number.isFinite)) return null;
  const [l, t, r, b] = box as Box;
  return l >= 0 && t >= 0 && r <= 1 && b <= 1 && r - l > 0.005 && b - t > 0.003 && (r - l) * (b - t) < 0.6 ? [l, t, r, b] : null;
}
/** Server-assigned evidence IDs: the model never has to keep a separate ID namespace consistent. */
export function flattenFact(fact: ModelFact): { fact: FlatFact; evidence: FlatEvidence[] } {
  const { evidence, ...rest } = fact;
  const entries = evidence.map((e, i) => ({ id: `evidence-${fact.id}-${i + 1}`, page: e.page, quote: e.quote, bbox: sanitizeBox(e.bbox) }));
  return { fact: { ...rest, evidence_ids: entries.map(e => e.id) }, evidence: entries };
}
export type Extraction = Omit<z.infer<typeof extractionSchema>, "facts"> & { facts: FlatFact[]; evidence: FlatEvidence[]; repairs: string[] };

export const evaluationSchema = z.object({
  rules: z.array(z.object({
    id, status: z.enum(["met", "not_met", "missing", "uncertain", "not_applicable"]),
    fact_ids: ids, note: text,
  }).strict()).max(300),
}).strict();
export type Evaluation = z.infer<typeof evaluationSchema>;
export const documentId = "source-pdf";


function unique(items: { id: string }[]) {
  if (new Set(items.map(i => i.id)).size !== items.length) throw new Error("Duplicate IDs");
}
/** Count repairs by kind for the audit trail; never records document values. */
function tally(repairs: string[], kind: string) { repairs.push(kind); }
export function summarizeRepairs(repairs: string[]) {
  const counts = new Map<string, number>();
  repairs.forEach(r => counts.set(r, (counts.get(r) || 0) + 1));
  return [...counts].map(([kind, n]) => `${kind} ×${n}`).join("; ");
}
/**
 * Schema-validate, then conservatively repair cross-references. Repairs only drop data or
 * lower certainty (never raise it), and each is tallied in `repairs`.
 */
export function validateExtraction(input: unknown): Extraction {
  const parsed = extractionSchema.parse(input);
  const repairs: string[] = [];
  const pageCount = parsed.page_count;
  // Sections: drop duplicates and out-of-range pages; a found form without pages becomes uncertain.
  const sections: z.infer<typeof sectionSchema>[] = [];
  for (const raw of parsed.sections) {
    if (raw.id === documentId || sections.some(s => s.id === raw.id)) { tally(repairs, "duplicate form dropped"); continue; }
    const section = { ...raw, pages: [...new Set(raw.pages.filter(p => p >= 1 && p <= pageCount))] };
    if (section.pages.length !== raw.pages.length) tally(repairs, "out-of-range form page dropped");
    if (section.status === "missing" && section.pages.length) { section.status = "uncertain"; tally(repairs, "missing form with pages marked uncertain"); }
    if (section.status === "found" && !section.pages.length) { section.status = "uncertain"; tally(repairs, "form without pages marked uncertain"); }
    sections.push(section);
  }
  const sectionIds = new Set(sections.map(s => s.id));
  const facts: FlatFact[] = [], evidence: FlatEvidence[] = [];
  for (const raw of parsed.facts) {
    let id = raw.id;
    for (let n = 2; id === documentId || sectionIds.has(id) || facts.some(f => f.id === id); n++) id = `${raw.id}-${n}`;
    if (id !== raw.id) tally(repairs, "duplicate fact ID renamed");
    const flat = flattenFact({ ...raw, id });
    const fact = flat.fact;
    fact.section_ids = [...new Set(fact.section_ids.filter(s => sectionIds.has(s)))];
    if (fact.section_ids.length !== raw.section_ids.length) tally(repairs, "unknown form link dropped");
    const kept: FlatEvidence[] = [];
    for (const entry of flat.evidence) {
      if (entry.page < 1 || entry.page > pageCount) { tally(repairs, "out-of-range citation dropped"); continue; }
      if (!entry.quote.trim()) { tally(repairs, "empty citation dropped"); continue; }
      if (!fact.section_ids.some(s => sections.find(x => x.id === s)!.pages.includes(entry.page))) {
        // The quote is on a page of another form: link that form rather than lose the citation.
        const owner = sections.find(x => x.pages.includes(entry.page));
        if (!owner) { tally(repairs, "citation outside every form dropped"); continue; }
        fact.section_ids.push(owner.id);
        tally(repairs, "citation linked to its containing form");
      }
      kept.push(entry);
    }
    fact.evidence_ids = kept.map(e => e.id);
    if (!fact.section_ids.length) { tally(repairs, "fact without a form dropped"); continue; }
    if (fact.status === "found" && (!kept.length || !fact.value.trim())) { fact.status = "uncertain"; tally(repairs, "unsupported fact marked uncertain"); }
    if (["missing", "redacted"].includes(fact.status) && (fact.value || kept.length)) { fact.status = "uncertain"; tally(repairs, "absent fact with a value marked uncertain"); }
    facts.push(fact);
    evidence.push(...kept);
  }
  if (!facts.length) throw new Error("No usable facts");
  const result: Extraction = { ...parsed, sections, facts, evidence, repairs };
  unique([...result.sections, ...result.facts, ...result.evidence]);
  return result;
}
export function validateEvaluation(input: unknown, extraction: Extraction): Rule[] {
  const result = evaluationSchema.parse(input);
  const byId = new Map<string, Evaluation["rules"][number]>();
  for (const rule of result.rules) if (!byId.has(rule.id)) byId.set(rule.id, rule);
  const facts = new Map(extraction.facts.map(f => [f.id, f]));
  return catalog.map(source => {
    const assessed = byId.get(source.id);
    if (!assessed) tally(extraction.repairs, "criterion without assessment marked uncertain");
    const result = assessed || { id: source.id, status: "uncertain" as const, fact_ids: [], note: "Claude did not return an assessment for this criterion. Review it manually." };
    const fact_ids = result.fact_ids.filter(id => facts.has(id));
    if (fact_ids.length !== result.fact_ids.length) tally(extraction.repairs, "unknown fact link dropped");
    let status: Rule["status"] = result.status;
    const supporting = fact_ids.map(id => facts.get(id)!);
    // A conclusive result must trace to readable evidence, including applicability.
    if (["met", "not_met", "not_applicable"].includes(status) && !source.superseded_by &&
      (!supporting.length || supporting.some(f => f.status !== "found" || !f.evidence_ids.length))) status = "uncertain";
    if (source.superseded_by) status = "not_applicable";
    // Human-review rules are routed by the decision tree (uncertain/not met → human review), never auto-denied.
    const note = result.note.trim() || "Claude returned no rationale for this assessment. Review it manually.";
    return { ...source, ...result, note, fact_ids, status, human_review: source.human_review || false };
  });
}
/**
 * Coordinator-facing suggestion from the staged decision tree, after identity and adult gates.
 * Never an autonomous admission action.
 */
export function recommend(rules: Rule[], identityMatch: Extraction["identity_match"] | "not_checked", adultStatus: Extraction["adult_status"] = "uncertain"): Recommendation {
  const tree = evaluateTree(rules);
  const byId = new Map(rules.map(r => [r.id, r]));
  const where = tree.stage ? `Stage ${tree.stage.number} · ${tree.stage.title}` : "";
  const ruleReasons = tree.rule_ids.map(id => `${id}: ${byId.get(id)?.note || "Review this criterion."}`);
  const base = { outcome: tree.outcome, stage: tree.stage?.number ?? null, rule_ids: tree.rule_ids };
  if (adultStatus !== "adult") return { ...base, status: "needs_information", outcome: "needs_review",
    reasons: ["These criteria apply to adults. Confirm age/applicability or request pediatric criteria review.", ...(where ? [`Tree result: ${outcomeLabels[tree.outcome]} at ${where}.`] : [])] };
  // "not_checked": no name was supplied, so there is nothing to cross-check.
  const identityOk = identityMatch === "match" || identityMatch === "not_checked";
  if (!identityOk && tree.outcome !== "denied") return { ...base, status: "needs_information", outcome: "needs_review",
    reasons: ["Confirm that the PDF belongs to the named patient.", ...(where ? [`Tree result: ${outcomeLabels[tree.outcome]} at ${where}.`] : []), ...ruleReasons] };
  if (tree.outcome === "denied" && identityOk) return { ...base, status: "recommend_denial", reasons: [`Denied at ${where}.`, ...ruleReasons] };
  if (tree.outcome === "approved") return { ...base, status: "recommend_approval",
    reasons: ["All six stages pass. Verify the CalAIM 182-day cap (Stage 1.2) and confirm before admission."], rule_ids: rules.filter(r => r.status === "met").map(r => r.id) };
  return { ...base, status: "needs_information", outcome: tree.outcome === "denied" ? "needs_review" : tree.outcome,
    reasons: [...(where ? [`${outcomeLabels[tree.outcome]} at ${where}.`] : []), ...(tree.outcome === "denied" ? ["Confirm patient identity before acting on the denial."] : []), ...ruleReasons] };
}
/** The patient's name as read from the packet, when Claude found it. */
function extractedName(extraction: Extraction) {
  return extraction.facts.find(f => f.status === "found" && /(^|_)(full_)?name$|patient_name|^name/i.test(f.key))?.value.trim().slice(0, 120) || "";
}
export function toReferral(extraction: Extraction, rules: Rule[], patientName: string, fileName: string): Referral {
  if ([...extraction.sections, ...extraction.facts].some(i => i.id === documentId)) throw new Error("Reserved node ID");
  return {
    id: crypto.randomUUID(), title: patientName || extractedName(extraction) || fileName.replace(/\.pdf$/i, ""), status: "analyzed", revision: 1,
    documents: [{ id: documentId, name: fileName, page_count: extraction.page_count, status: "analyzed", error: null, pages: [] }],
    sections: extraction.sections.map(s => ({ ...s, document_id: documentId })),
    evidence: extraction.evidence.map(e => ({ ...e, document_id: documentId, confidence: null, method: "claude" })),
    facts: extraction.facts.map(f => ({ ...f, original_value: f.value, review_note: "", discrepancy: f.note, kind: "claude", rule_ids: rules.filter(r => r.fact_ids.includes(f.id)).map(r => r.id) })),
    checklist: { precedence: criteriaPrecedence, source_url: criteriaSource, rules, counts: Object.fromEntries([...new Set(rules.map(r => r.status))].map(s => [s, rules.filter(r => r.status === s).length])) },
    recommendation: recommend(rules, patientName ? extraction.identity_match : "not_checked", extraction.adult_status), error: null,
    audit: [{ at: new Date().toISOString(), type: "claude_analysis", id: documentId, note: "Two-pass Claude analysis (extraction, then criteria review). Page citations and highlight boxes are model-reported approximations. Coordinator confirmation required." },
      ...(extraction.repairs.length ? [{ at: new Date().toISOString(), type: "validation_repair", id: documentId, note: `Validation repairs (certainty only lowered): ${summarizeRepairs(extraction.repairs)}.` }] : [])],
  };
}

/** Strip constraints unsupported by Claude's JSON grammar; Zod still enforces them locally. */
export function outputSchema(schema: z.ZodType) {
  return JSON.parse(JSON.stringify(z.toJSONSchema(schema), (key, value) =>
    ["$schema", "minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems"].includes(key) ? undefined : value));
}
