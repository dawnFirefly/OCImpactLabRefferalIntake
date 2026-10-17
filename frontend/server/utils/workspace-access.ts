import { createError, getHeader, getRequestURL, type H3Event } from "h3";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

type AccessConfig = {
  workspaceOrigin: string;
  cloudflareAccessTeamDomain: string;
  cloudflareAccessAudience: string;
  workspaceAllowedEmails: string;
};
const keySets = new Map<string, JWTVerifyGetKey>();

/** Validate the signed assertion, not just the presence of an Access header. */
export async function checkWorkspaceAccess(
  request: { url: URL; origin?: string; fetchSite?: string; token?: string },
  config: AccessConfig,
  getKey?: JWTVerifyGetKey,
) {
  const { url, origin, fetchSite, token } = request;
  if (origin !== url.origin || fetchSite === "cross-site") {
    throw createError({ statusCode: 403, statusMessage: "Use the workspace's own page for this action." });
  }
  if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return;
  if (url.protocol !== "https:" || !config.workspaceOrigin || url.origin !== config.workspaceOrigin) {
    throw createError({ statusCode: 403, statusMessage: "This workspace hostname is not enabled." });
  }
  const domain = config.cloudflareAccessTeamDomain;
  const emails = config.workspaceAllowedEmails.split(",").map(email => email.trim().toLowerCase()).filter(Boolean);
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com$/.test(domain) ||
      !config.cloudflareAccessAudience || !emails.length) {
    throw createError({ statusCode: 503, statusMessage: "Workspace access is not configured." });
  }
  if (!token) throw createError({ statusCode: 401, statusMessage: "Sign in through Cloudflare Access to continue." });
  try {
    if (!getKey) {
      if (!keySets.has(domain)) keySets.set(domain, createRemoteJWKSet(new URL(`https://${domain}/cdn-cgi/access/certs`)));
      getKey = keySets.get(domain)!;
    }
    const { payload } = await jwtVerify(token, getKey, {
      issuer: `https://${domain}`, audience: config.cloudflareAccessAudience,
      algorithms: ["RS256"], requiredClaims: ["sub", "exp", "iat", "email"],
    });
    if (typeof payload.email !== "string" || !emails.includes(payload.email.toLowerCase())) throw new Error("Identity is not allowed");
  } catch {
    throw createError({ statusCode: 401, statusMessage: "Workspace access could not be verified. Sign in again." });
  }
}

export async function requireWorkspace(event: H3Event, config: AccessConfig) {
  return checkWorkspaceAccess({
    url: getRequestURL(event), origin: getHeader(event, "origin"),
    fetchSite: getHeader(event, "sec-fetch-site"), token: getHeader(event, "cf-access-jwt-assertion"),
  }, config);
}
