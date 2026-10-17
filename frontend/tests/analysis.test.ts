import test from "node:test";
import assert from "node:assert/strict";
import { catalog, validateExtraction, validateEvaluation, recommend, toReferral } from "../server/utils/analysis-contract.ts";
import { callClaude, AnalysisFailure } from "../server/utils/claude.ts";
import { TopLevelArrayItems } from "../server/utils/stream-json.ts";
import { decisionTree, evaluateTree, unreviewedRules } from "../shared/decision-tree.ts";
import { extractionSchema, sanitizeBox } from "../server/utils/analysis-contract.ts";
import type { Evaluation } from "../server/utils/analysis-contract.ts";

const extraction = () => ({
  page_count: 3,
  sections: [{ id: "section-application", title: "Application", category: "Application", pages: [1], status: "found" as const }],
  facts: [{ id: "fact-name", key: "name", label: "Patient name", group: "Identity", value: "Fictional Person", unit: "", section_ids: ["section-application"],
    evidence: [{ page: 1, quote: "Name: Fictional Person", bbox: [0.1, 0.2, 0.5, 0.24] as number[] | null }], status: "found" as const, note: "" }],
  identity_match: "match" as const, adult_status: "adult" as const,
});
const assessment = (): Evaluation => ({ rules: catalog.map(r => ({ id: r.id,
  status: r.kind === "any_of" ? "met" as const : "not_applicable" as const,
  fact_ids: ["fact-name"], note: "Fictional test assessment; not a clinical conclusion." })) });

test("source → section → fact → rule contract preserves original values, page-only citations and bidirectional links", () => {
  const extracted = validateExtraction(extraction());
  const input = assessment();
  input.rules.find(r => r.id === "DOC-1")!.status = "met";
  const rules = validateEvaluation(input, extracted);
  const result = toReferral(extracted, rules, "Fictional Person", "fictional.pdf");
  assert.equal(result.documents.length, 1);
  assert.equal(result.sections![0]!.document_id, result.documents[0]!.id);
  assert.deepEqual(result.evidence[0]!.bbox, [0.1, 0.2, 0.5, 0.24]);
  assert.equal(result.evidence[0]!.id, "evidence-fact-name-1");
  assert.deepEqual(result.facts[0]!.evidence_ids, ["evidence-fact-name-1"]);
  assert.equal(result.facts[0]!.original_value, "Fictional Person");
  assert.ok(result.facts[0]!.rule_ids.includes("DOC-1"));
  assert.ok(result.checklist.rules.find(r => r.id === "DOC-1")!.fact_ids.includes("fact-name"));
  assert.equal(result.recommendation!.status, "recommend_approval");
});

test("malformed output is rejected; bad cross-references are repaired by dropping data or lowering certainty only", () => {
  assert.throws(() => validateExtraction({}));
  const bad = extraction(); bad.facts[0]!.evidence[0]!.page = 4;
  const outOfRange = validateExtraction(bad);
  assert.deepEqual(outOfRange.evidence, []);
  assert.equal(outOfRange.facts[0]!.status, "uncertain", "a found fact that loses its only citation is no longer found");
  assert.ok(outOfRange.repairs.includes("out-of-range citation dropped"));
  const dangling = extraction(); dangling.facts[0]!.section_ids = ["nonexistent"];
  assert.deepEqual(validateExtraction(dangling).facts[0]!.section_ids, ["section-application"], "citation re-links to the form that contains its page");
  const orphan = extraction(); orphan.facts[0]!.section_ids = ["nonexistent"]; orphan.facts[0]!.evidence = [];
  assert.throws(() => validateExtraction(orphan), /No usable facts/);
  const wrongSection = extraction(); wrongSection.facts[0]!.evidence[0]!.page = 2;
  const outside = validateExtraction(wrongSection);
  assert.deepEqual(outside.evidence, [], "a quote on a page no form covers is dropped");
  const duplicate = extraction(); duplicate.facts.push({ ...duplicate.facts[0]! });
  assert.deepEqual(validateExtraction(duplicate).facts.map(f => f.id), ["fact-name", "fact-name-2"]);
  const foundNoPages = extraction(); foundNoPages.sections.push({ id: "section-x", title: "X", category: "X", pages: [], status: "found" });
  assert.equal(validateExtraction(foundNoPages).sections[1]!.status, "uncertain");
});

test("redaction and missing evidence cannot satisfy a requirement or become a denial", () => {
  const input = extraction();
  const redacted = { ...input.facts[0]!, id: "fact-redacted", value: "", status: "redacted" as const, evidence: [] };
  const extracted = validateExtraction({ ...input, facts: [redacted] });
  const evaluated = assessment();
  evaluated.rules.forEach(r => { r.fact_ids = ["fact-redacted"]; });
  const rules = validateEvaluation(evaluated, extracted);
  assert.equal(rules.find(r => r.id === "DOC-1")!.status, "uncertain");
  assert.equal(recommend(rules, "match", "adult").status, "needs_information");
  assert.equal(validateExtraction({ ...input, facts: [{ ...redacted, value: "invented" }] }).facts[0]!.status, "uncertain", "a redacted fact with a value cannot stay redacted or become found");
});

test("conflicting observations stay uncertain even when a model marks a rule satisfied", () => {
  const input = extraction();
  const extracted = validateExtraction({ ...input, facts: [{ ...input.facts[0]!, status: "conflicting", note: "Different source accounts" }] });
  const assessed = assessment();
  assessed.rules.find(r => r.id === "DOC-1")!.status = "met";
  assert.equal(validateEvaluation(assessed, extracted).find(r => r.id === "DOC-1")!.status, "uncertain");
});

test("missing rule assessments and unknown fact references become uncertain, never conclusive", () => {
  const input = assessment(); const dropped = input.rules.pop()!;
  const extracted = validateExtraction(extraction());
  assert.equal(validateEvaluation(input, extracted).find(r => r.id === dropped.id)!.status, dropped.id.startsWith("FORM-X6") ? "not_applicable" : "uncertain");
  const bad = assessment(); bad.rules.find(r => r.id === "DOC-1")!.fact_ids = ["unknown"]; bad.rules.find(r => r.id === "DOC-1")!.status = "met";
  const rule = validateEvaluation(bad, validateExtraction(extraction())).find(r => r.id === "DOC-1")!;
  assert.deepEqual(rule.fact_ids, []);
  assert.equal(rule.status, "uncertain");
});

test("precedence, case-by-case review, general OR, and explicit failures drive recommendations", () => {
  const rules = validateEvaluation(assessment(), validateExtraction(extraction()));
  const required = rules.find(r => r.id === "DOC-1")!;
  required.status = "missing";
  assert.equal(recommend(rules, "match", "adult").status, "needs_information");
  required.status = "met";
  const general = rules.filter(r => r.kind === "any_of");
  general[1]!.status = "uncertain"; general[2]!.status = "missing";
  assert.equal(recommend(rules, "match", "adult").status, "recommend_approval");
  general.forEach(r => { r.status = "not_met"; });
  assert.equal(recommend(rules, "match", "adult").status, "recommend_denial");
  general[0]!.status = "met";
  const sexOffender = rules.find(r => r.id === "OTH-2")!;
  sexOffender.status = "uncertain";
  assert.equal(recommend(rules, "match", "adult").outcome, "human_review", "OTH-2 routes to human review, never denial");
  sexOffender.status = "not_met";
  assert.equal(recommend(rules, "match", "adult").outcome, "human_review");
  sexOffender.status = "not_applicable";
  required.status = "not_met";
  assert.equal(recommend(rules, "match", "adult").outcome, "rfi", "a missing document is a request for information, not a denial");
  required.status = "met";
  rules.find(r => r.id === "MH-2")!.status = "not_met";
  const denied = recommend(rules, "match", "adult");
  assert.equal(denied.status, "recommend_denial");
  assert.equal(denied.stage, 2);
  assert.deepEqual(denied.rule_ids, ["MH-2"]);
  assert.equal(recommend(rules, "mismatch", "adult").status, "needs_information");
  assert.equal(rules.find(r => r.id === "FORM-X6")!.status, "not_applicable");
  assert.equal(recommend(rules, "match", "child").status, "needs_information");
  assert.equal(recommend(rules, "match").status, "needs_information");
});

/** Minimal Messages API SSE stream so the real SDK parses a fictional response. */
function sse(message: { stop_reason: string; text?: string }) {
  const events = [
    ["message_start", { type: "message_start", message: { id: "msg_test", type: "message", role: "assistant", model: "test-model", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } }],
    ...(message.text === undefined ? [] : [
      ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
      ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: message.text } }],
      ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ]),
    ["message_delta", { type: "message_delta", delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: { output_tokens: 1 } }],
    ["message_stop", { type: "message_stop" }],
  ];
  return events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join("");
}
test("Claude transport rejects truncated output, authentication failure, and malformed JSON without leaking provider content", async () => {
  const invoke = (body: string, status = 200) => callClaude({ apiKey: "fictional-key", model: "test-model", schema: extractionSchema, system: "test", content: [],
    transport: (async () => new Response(body, { status, headers: { "content-type": status === 200 ? "text/event-stream" : "application/json" } })) as typeof fetch });
  await assert.rejects(invoke(sse({ stop_reason: "max_tokens", text: "{" })), /incomplete/);
  await assert.rejects(invoke(sse({ stop_reason: "refusal" })), /declined/);
  await assert.rejects(invoke(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "sensitive must never reach client" } }), 401),
    (e: unknown) => e instanceof AnalysisFailure && e.status === 503 && !e.message.includes("sensitive"));
  await assert.rejects(invoke(sse({ stop_reason: "end_turn", text: "invalid" })), /invalid analysis/);
  assert.deepEqual(await invoke(sse({ stop_reason: "end_turn", text: '{"ok":true}' })), { ok: true });
});

test("streamed structured output yields each section and fact as soon as it closes, across arbitrary chunk boundaries", () => {
  const text = JSON.stringify(extraction());
  for (const size of [1, 3, 17, text.length]) {
    const seen: string[] = [];
    const scanner = new TopLevelArrayItems((key, value) => seen.push(`${key}:${(value as { id: string }).id}`));
    for (let i = 0; i < text.length; i += size) scanner.push(text.slice(i, i + size));
    assert.deepEqual(seen, ["sections:section-application", "facts:fact-name"]);
  }
  const partial: string[] = [];
  const scanner = new TopLevelArrayItems((key) => partial.push(key));
  scanner.push('{"page_count":3,"sections":[{"id":"a","title":"he said \\"}{\\"","pages":[1]},{"id":"b"');
  assert.deepEqual(partial, ["sections"], "nested arrays, escaped quotes and braces in strings are not items; unfinished items wait");
});

test("model-located highlight boxes are kept only when they are sane normalized rectangles", () => {
  assert.deepEqual(sanitizeBox([0.1, 0.1, 0.4, 0.15]), [0.1, 0.1, 0.4, 0.15]);
  for (const bad of [null, [0.1, 0.1, 0.4], [0.5, 0.1, 0.4, 0.2], [-0.1, 0, 0.3, 0.1], [0, 0, 1.2, 0.1], [0, 0, 1, 1], [0.1, 0.1, 0.1, 0.1]])
    assert.equal(sanitizeBox(bad), null);
  const input = extraction(); input.facts[0]!.evidence[0]!.bbox = [2, 2, 3, 3];
  assert.equal(validateExtraction(input).evidence[0]!.bbox, null, "an invalid box degrades to a page-only citation instead of rejecting the analysis");
});

test("decision tree covers every source criterion exactly once and walks stages in order", () => {
  const placed = decisionTree.flatMap(s => s.steps.flatMap(step => step.rule_ids));
  assert.equal(new Set(placed).size, placed.length, "no criterion appears twice");
  assert.deepEqual([...placed].sort(), catalog.map(r => r.id).sort(), "every criterion is placed");
  assert.equal(evaluateTree(unreviewedRules()).outcome, "not_reviewed");
  const pass = unreviewedRules().map(r => ({ ...r, status: r.kind === "any_of" ? "met" : "not_applicable" }));
  assert.equal(evaluateTree(pass).outcome, "approved");
  const set = (id: string, status: string) => pass.map(r => r.id === id ? { ...r, status } : r);
  assert.equal(evaluateTree(set("RESP-3", "missing")).outcome, "conditional");
  assert.equal(evaluateTree(set("INF-1", "missing")).outcome, "rfi");
  assert.equal(evaluateTree(set("MH-4", "not_met")).outcome, "hold");
  assert.equal(evaluateTree(set("RSP-X5", "missing")).outcome, "needs_review", "missing evidence for an exclusion is unresolved, not a denial");
  assert.equal(evaluateTree(set("RSP-X5", "not_met")).stage?.number, 4);
  assert.equal(evaluateTree(set("RSP-E1", "not_met")).outcome, "approved", "eligible examples never gate");
  const noGeneral = pass.map(r => r.kind === "any_of" ? { ...r, status: "not_met" } : r);
  assert.equal(evaluateTree(noGeneral).outcome, "denied");
});
