import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from "jose";
import { checkWorkspaceAccess } from "../server/utils/workspace-access.ts";

const config = {
  workspaceOrigin: "https://workspace.example.test",
  cloudflareAccessTeamDomain: "fictional-team.cloudflareaccess.com",
  cloudflareAccessAudience: "fictional-audience",
  workspaceAllowedEmails: "reviewer@example.test",
};
const remote = { url: new URL(config.workspaceOrigin + "/api/packets"), origin: config.workspaceOrigin };

test("workspace mutations reject cross-origin requests, unconfigured hosts and missing Access settings", async () => {
  await checkWorkspaceAccess({ url: new URL("http://127.0.0.1:3000/api/packets"), origin: "http://127.0.0.1:3000" }, config);
  for (const request of [{ ...remote, origin: "https://other.example.test" }, { ...remote, fetchSite: "cross-site" },
    { ...remote, url: new URL("https://other.example.test/api/packets"), origin: "https://other.example.test" }]) {
    await assert.rejects(checkWorkspaceAccess(request, config), (error: any) => error.statusCode === 403);
  }
  await assert.rejects(checkWorkspaceAccess(remote, { ...config, cloudflareAccessTeamDomain: "" }), (error: any) => error.statusCode === 503);
  await assert.rejects(checkWorkspaceAccess(remote, config), (error: any) => error.statusCode === 401);
});

test("remote access requires the correct signature, issuer, audience, expiry and allowed email", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  const keys = createLocalJWKSet({ keys: [{ ...jwk, kid: "test" }] });
  async function token(overrides: Record<string, unknown> = {}) {
    return new SignJWT({ email: "reviewer@example.test", sub: "fictional-user", iss: `https://${config.cloudflareAccessTeamDomain}`,
      aud: config.cloudflareAccessAudience, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60, ...overrides })
      .setProtectedHeader({ alg: "RS256", kid: "test" }).sign(privateKey);
  }
  await checkWorkspaceAccess({ ...remote, token: await token() }, config, keys);
  for (const overrides of [{ iss: "https://untrusted.example.test" }, { aud: "other-app" }, { exp: 1 }, { email: "stranger@example.test" }]) {
    await assert.rejects(checkWorkspaceAccess({ ...remote, token: await token(overrides) }, config, keys), (error: any) => error.statusCode === 401);
  }
  const other = await generateKeyPair("RS256");
  const forged = await new SignJWT({ email: "reviewer@example.test" }).setProtectedHeader({ alg: "RS256", kid: "test" }).sign(other.privateKey);
  await assert.rejects(checkWorkspaceAccess({ ...remote, token: forged }, config, keys), (error: any) => error.statusCode === 401);
});

test("temporary public access skips only the sign-in check, never the origin or hostname checks", async () => {
  const config = { workspaceOrigin: "https://app.example.com", cloudflareAccessTeamDomain: "", cloudflareAccessAudience: "", workspaceAllowedEmails: "", workspacePublicAccess: "true" };
  const url = new URL("https://app.example.com/api/analyze");
  await checkWorkspaceAccess({ url, origin: url.origin }, config);
  await assert.rejects(checkWorkspaceAccess({ url, origin: "https://evil.example" }, config), /own page/);
  const other = new URL("https://other.example.com/api/analyze");
  await assert.rejects(checkWorkspaceAccess({ url: other, origin: other.origin }, config), /not enabled/);
});

test("same-origin reads may omit Origin; mutations and cross-site reads cannot", async () => {
  const local = { url: new URL("http://localhost:3000/api/applicants"), method: "GET" };
  await checkWorkspaceAccess(local, config);
  await assert.rejects(checkWorkspaceAccess({ ...local, method: "POST" }, config), /own page/);
  await assert.rejects(checkWorkspaceAccess({ ...local, fetchSite: "cross-site" }, config), /own page/);
  await checkWorkspaceAccess({ url: remote.url, method: "GET" }, { ...config, workspacePublicAccess: "true" });
});
