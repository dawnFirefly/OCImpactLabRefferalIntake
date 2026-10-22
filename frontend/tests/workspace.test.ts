import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workspaceStore, type WorkspaceBucket } from "../server/utils/workspace-store.ts";
import { parseWorkspaceReferral } from "../shared/workspace.ts";
import { validateExtraction, validateEvaluation, toReferral } from "../server/utils/analysis-contract.ts";
const patientA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", patientB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
function fixture(id = patientA) {
  const extracted = validateExtraction({ page_count: 2,
    sections: [{ id: "section-form", title: "Fictional application", category: "Application", pages: [1, 2], status: "found" }],
    facts: Array.from({ length: 12 }, (_, i) => ({ id: `fact-${i}`, key: `field-${i}`, label: `Fictional field ${i}`, group: "Identity", value: `Fictional value ${i}`, unit: "", status: "found", note: "", section_ids: ["section-form"], evidence: [{ page: i % 2 + 1, quote: `Fictional value ${i}`, bbox: null }] })),
    identity_match: "match", adult_status: "adult" });
  const r = toReferral(extracted, validateEvaluation({ rules: [{ id: "DOC-1", status: "met", fact_ids: ["fact-0", "fact-11"], note: "Fictional only" }] }, extracted), "Fictional Patient", "fictional.pdf");
  r.id = `stored-${id}`;
  r.facts[11]!.review_note = "Note on a node beyond the visible first five";
  r.graphLayout = { positions: { "fact-11": { x: 512, y: 123 } }, viewport: { x: -32, y: 90, zoom: 0.8 } };
  return r;
}
test("full hidden graph, notes, and layout survive reopening and remain isolated by patient", async () => {
  const root = await mkdtemp(join(tmpdir(), "referral-workspaces-"));
  try {
    const store = workspaceStore(undefined, root), a = fixture(), b = fixture(patientB);
    b.facts[11]!.review_note = "Patient B note on same fact ID";
    await store.write(patientA, parseWorkspaceReferral(a, patientA), 0);
    await store.write(patientB, parseWorkspaceReferral(b, patientB), 0);
    const reopened = workspaceStore(undefined, root);
    const saved = (await reopened.read(patientA))!.value.referral;
    assert.equal(saved.facts.length, 12);
    assert.equal(saved.facts[11]!.review_note, a.facts[11]!.review_note);
    assert.deepEqual(saved.graphLayout, a.graphLayout);
    assert.deepEqual(saved.checklist.rules.find(r => r.id === "DOC-1")!.fact_ids, ["fact-0", "fact-11"]);
    assert.equal((await reopened.read(patientB))!.value.referral.facts[11]!.review_note, b.facts[11]!.review_note);
    await assert.rejects(store.write(patientA, a, 0), (e: any) => e.statusCode === 409);
    await store.remove(patientA);
    await assert.rejects(store.read(patientA), (e: any) => e.statusCode === 404);
    await assert.rejects(store.write(patientA, a, 0), (e: any) => e.statusCode === 404);
    assert.ok(await store.read(patientB));
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("validation rejects cross-patient saves, dangling/asymmetric links, duplicate IDs and bad coordinates", () => {
  assert.throws(() => parseWorkspaceReferral(fixture(), patientB), /Applicant mismatch/);
  for (const edit of [
    (r: ReturnType<typeof fixture>) => { r.facts[0]!.evidence_ids.push("unknown"); },
    (r: ReturnType<typeof fixture>) => { r.facts[1]!.id = r.facts[0]!.id; },
    (r: ReturnType<typeof fixture>) => { r.graphLayout!.positions["fact-11"]!.x = Infinity; },
    (r: ReturnType<typeof fixture>) => { r.checklist.rules.find(v => v.id === "DOC-1")!.fact_ids = []; },
  ]) { const r = fixture(); edit(r); assert.throws(() => parseWorkspaceReferral(r, patientA)); }
  const input = { ...fixture(), apiKey: "never save" }; input.documents[0]!.local_url = "blob:temporary";
  const parsed = parseWorkspaceReferral(input, patientA);
  assert.equal("apiKey" in parsed, false); assert.equal(parsed.documents[0]!.local_url, undefined);
});
test("R2 protects simultaneous first writes, retains revisions and erases graph data on deletion", async () => {
  const values = new Map<string, { json: string; etag: string }>(); let version = 0;
  const bucket: WorkspaceBucket = {
    async get(key) { const item = values.get(key); return item ? { text: async () => item.json, etag: item.etag } : null; },
    async put(key, json, options) {
      const previous = values.get(key);
      if ((options.onlyIf.etagDoesNotMatch === "*" && previous) || (options.onlyIf.etagMatches && options.onlyIf.etagMatches !== previous?.etag)) return null;
      values.set(key, { json, etag: String(++version) }); return {};
    },
    async delete(key) { values.delete(key); },
    async list({ prefix }) { return { objects: [...values.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })), truncated: false }; },
  };
  const store = workspaceStore(bucket);
  const results = await Promise.allSettled([store.write(patientA, fixture(), 0), store.write(patientA, fixture(), 0)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  await store.write(patientA, fixture(), 1);
  assert.equal((await store.read(patientA))!.value.revision, 2);
  await store.remove(patientA);
  assert.ok(![...values.keys()].some(key => key.startsWith(`workspace-history/${patientA}/`)));
  assert.ok(!values.get(`workspaces/${patientA}.json`)!.json.includes("Fictional"));
});
