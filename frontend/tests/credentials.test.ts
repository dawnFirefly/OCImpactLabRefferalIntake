import test from "node:test";
import assert from "node:assert/strict";
import { anthropicKey } from "../server/utils/credentials.ts";

test("local Nuxt requests use private runtime config", () => {
  assert.equal(anthropicKey({ anthropicApiKey: "fictional-local-key" }), "fictional-local-key");
});

test("Workers use their own secret binding, never a baked-in or local credential", () => {
  const config = { anthropicApiKey: "fictional-build-key" };
  assert.equal(anthropicKey(config, { NUXT_ANTHROPIC_API_KEY: "fictional-worker-key" }), "fictional-worker-key");
  for (const value of [undefined, null, "", "  ", 42, {}]) {
    assert.equal(anthropicKey(config, { NUXT_ANTHROPIC_API_KEY: value }), "");
  }
  assert.equal(anthropicKey(config, {}), "");
});
