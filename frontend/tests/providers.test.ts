import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { callAi, parseModelJson, type SelectedAi } from "../server/utils/ai-provider.ts";
import { combinePages } from "../server/utils/vision-analysis.ts";
import { defaultModels } from "../shared/ai.ts";
const config: SelectedAi = { provider: "cloudflare", apiKey: "", accountId: "", ...defaultModels.cloudflare };
test("Workers AI binding uses its configured model and JSON schema without external transport", async () => {
  let calls = 0;
  const result = await callAi({ ...config, binding: { async run(model, body) { calls++; assert.equal(model, config.reviewModel); assert.ok(body.response_format); return { response: { connected: true } }; } } }, { model: config.reviewModel, schema: z.object({ connected: z.boolean() }), system: "Return JSON", text: "Fictional test" }, async () => { throw new Error("Must not call external transport"); });
  assert.deepEqual(result, { connected: true }); assert.equal(calls, 1);
});
test("OpenCode uses its official chat endpoint with selected credentials and page image", async () => {
  const image = "data:image/jpeg;base64,/9j/";
  await callAi({ ...config, provider: "opencode", apiKey: "fictional-key" }, { model: "fictional-vision", schema: z.object({ ok: z.boolean() }), system: "Read page", text: "Fictional page", image }, async (url, options) => {
    assert.equal(url, "https://opencode.ai/inference/openai/v1/chat/completions");
    assert.equal((options?.headers as Record<string, string>).Authorization, "Bearer fictional-key");
    assert.equal(JSON.parse(options?.body as string).messages[1].content[1].image_url.url, image);
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }] });
  });
});
test("provider failures and malformed/truncated output never leak sensitive response content", async () => {
  for (const response of [new Response("sensitive provider data", { status: 401 }), Response.json({ choices: [{ finish_reason: "length", message: { content: "{}" } }] })]) {
    await assert.rejects(callAi({ ...config, provider: "opencode", apiKey: "private-key" }, { model: "fictional-model", schema: z.object({}), system: "test", text: "test" }, async () => response), e => !String(e).includes("sensitive") && !String(e).includes("private-key"));
  }
  assert.throws(() => parseModelJson({ response: "incomplete {" }), /invalid JSON/);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(callAi(config, { model: config.reviewModel, schema: z.object({}), text: "", system: "", signal: abort.signal }));
});
test("page merging overrides model page labels and separates repeated IDs across pages", () => {
  const page = { page_count: 1, identity_match: "uncertain" as const, adult_status: "uncertain" as const,
    sections: [{ id: "section-a", title: "Form", category: "Form", pages: [99], status: "found" as const }],
    facts: [{ id: "fact-a", key: "name", label: "Name", group: "Identity", value: "Fictional", unit: "", status: "found" as const, note: "", section_ids: ["section-a"], evidence: [{ page: 99, quote: "Fictional", bbox: null }] }] };
  const merged = combinePages([page, page]); assert.equal(merged.page_count, 2);
  assert.equal(merged.facts[0]!.evidence[0]!.page, 1); assert.equal(merged.facts[1]!.evidence[0]!.page, 2);
  assert.notEqual(merged.facts[0]!.id, merged.facts[1]!.id); assert.deepEqual(merged.facts[1]!.section_ids, [merged.sections[1]!.id]);
});

test("complete Workers AI page extraction and criteria review preserve evidence and provenance", async () => {
  const { analyzeVision } = await import("../server/utils/vision-analysis.ts");
  const { catalog } = await import("../server/utils/analysis-contract.ts");
  let extractionCalls = 0, reviewCalls = 0;
  const binding = { async run(model: string, body: Record<string, unknown>) {
    if (model === config.extractionModel) {
      extractionCalls++;
      assert.ok(body.image);
      return { response: JSON.stringify({ page_count: 1, sections: [{ id: "section-a", title: "Fictional form", category: "Application", pages: [1], status: "found" }], facts: [{ id: "fact-name", key: "name", label: "Name", group: "Identity", value: "Fictional Patient", unit: "", status: "found", note: "", section_ids: ["section-a"], evidence: [{ page: 1, quote: "Fictional Patient", bbox: null }] }], identity_match: "match", adult_status: "adult" }) };
    }
    reviewCalls++;
    return { response: { rules: catalog.map(r => ({ id: r.id, status: "uncertain", fact_ids: ["p1-fact-name"], note: "Fictional assessment, requires review" })) } };
  } };
  const progress: unknown[] = [];
  const result = await analyzeVision({ ...config, binding }, ["data:image/jpeg;base64,/9j/"], "Fictional Patient", "fictional.pdf", new AbortController().signal, update => progress.push(update));
  assert.equal(extractionCalls, 1); assert.ok(reviewCalls > 1);
  assert.equal(result.evidence[0]!.method, "cloudflare");
  assert.equal(result.evidence[0]!.page, 1);
  assert.equal(result.analysisProvider!.provider, "cloudflare");
  assert.equal(result.checklist.rules.length, catalog.length);
  assert.equal(result.recommendation!.status, "needs_information");
  assert.ok(progress.length > 1);
});
