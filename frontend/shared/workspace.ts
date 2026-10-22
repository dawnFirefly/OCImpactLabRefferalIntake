import { z } from "zod";
import type { Referral } from "../app/types.ts";

const id = z.string().min(1).max(120);
const text = z.string().max(12000);
const ids = z.array(id).max(1000);
const point = z.object({ x: z.number().min(-100000).max(100000), y: z.number().min(-100000).max(100000) });
export const layoutSchema = z.object({
  positions: z.record(id, point),
  viewport: point.extend({ zoom: z.number().min(0.1).max(4) }).optional(),
});
export const referralSchema = z.object({
  id, title: text, status: z.enum(["analyzed", "awaiting_claude", "demo", "mock_review"]), revision: z.number().int().nonnegative(),
  documents: z.array(z.object({ id, name: text, page_count: z.number().int().min(1).max(1000).nullable(), status: text,
    error: text.nullable(), pages: z.array(z.object({ number: z.number().int(), rotation: z.number(), method: text, error: text.optional() })).max(1000) })).length(1),
  sections: z.array(z.object({ id, document_id: id, title: text, category: text, pages: z.array(z.number().int().min(1)).max(1000), status: z.enum(["found", "missing", "uncertain"]) })).max(150).optional(),
  facts: z.array(z.object({ id, key: id, label: text, group: text, value: text, original_value: text, unit: text,
    section_ids: ids.optional(), evidence_ids: ids, rule_ids: ids, kind: text, status: text, review_note: text, discrepancy: text.optional() })).max(500),
  evidence: z.array(z.object({ id, document_id: id, page: z.number().int().min(1), quote: text,
    bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(), confidence: z.number().nullable(), method: z.enum(["synthetic", "claude", "cloudflare", "opencode"]) })).max(10000),
  checklist: z.object({ precedence: text, source_url: text, counts: z.record(z.string(), z.number()), rules: z.array(z.object({
    id, text, kind: text, section: text, status: text, fact_ids: ids, note: text, original_note: text.optional(), review_note: text.optional(), human_review: z.boolean().optional(), superseded_by: id.optional(),
  })).max(300) }),
  recommendation: z.object({ status: z.enum(["recommend_approval", "recommend_denial", "needs_information"]),
    outcome: z.enum(["approved", "denied", "human_review", "hold", "conditional", "rfi", "needs_review", "not_reviewed"]).optional(),
    stage: z.number().int().nullable().optional(), reasons: z.array(text).max(1000), rule_ids: ids }).optional(),
  audit: z.array(z.object({ at: z.string().datetime(), type: id, id, note: text })).max(10000),
  graphLayout: layoutSchema.optional(),
  analysisProvider: z.object({ provider: z.enum(["cloudflare", "anthropic", "opencode"]), extractionModel: text, reviewModel: text }).optional(),
  error: text.nullable(),
});
export type Workspace = { schemaVersion: 1; revision: number; updatedAt: string; referral: Referral };

/** Canonical references encode the entire graph, independent of visible canvas pages. */
export function parseWorkspaceReferral(input: unknown, applicantId: string): Referral {
  const r = referralSchema.parse(input);
  if (r.id !== `stored-${applicantId}`) throw new Error("Applicant mismatch");
  const documents = new Set(r.documents.map(d => d.id));
  const sections = new Set(r.sections?.map(s => s.id));
  const facts = new Set(r.facts.map(f => f.id));
  const rules = new Set(r.checklist.rules.map(v => v.id));
  const evidence = new Set(r.evidence.map(e => e.id));
  const all = [...documents, ...(r.sections || []).map(s => s.id), ...r.facts.map(f => f.id), ...r.evidence.map(e => e.id), ...r.checklist.rules.map(v => v.id)];
  if (new Set(all).size !== all.length) throw new Error("Duplicate graph ID");
  for (const s of r.sections || []) if (!documents.has(s.document_id)) throw new Error("Unknown document");
  for (const e of r.evidence) {
    const doc = r.documents.find(d => d.id === e.document_id);
    if (!doc || (doc.page_count !== null && e.page > doc.page_count)) throw new Error("Invalid citation");
    if (e.bbox && (!e.bbox.every(n => n >= 0 && n <= 1) || e.bbox[2] <= e.bbox[0] || e.bbox[3] <= e.bbox[1])) throw new Error("Invalid highlight");
  }
  for (const f of r.facts) {
    if (f.section_ids?.some(v => !sections.has(v)) || f.evidence_ids.some(v => !evidence.has(v)) || f.rule_ids.some(v => !rules.has(v))) throw new Error("Unknown fact link");
    if (r.checklist.rules.some(rule => rule.fact_ids.includes(f.id) !== f.rule_ids.includes(rule.id))) throw new Error("Inconsistent rule link");
  }
  for (const rule of r.checklist.rules) if (rule.fact_ids.some(v => !facts.has(v))) throw new Error("Unknown rule link");
  if (r.graphLayout && (Object.keys(r.graphLayout.positions).length > 1000 || Object.keys(r.graphLayout.positions).some(v => !documents.has(v) && !sections.has(v) && !facts.has(v)))) throw new Error("Unknown layout node");
  return r;
}
