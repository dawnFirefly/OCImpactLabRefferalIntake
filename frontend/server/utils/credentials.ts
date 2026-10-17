/** Cloudflare credentials come only from that Worker's secret binding. */
export function anthropicKey(
  config: { anthropicApiKey: string },
  cloudflareEnv?: Record<string, unknown>,
): string {
  const value = cloudflareEnv === undefined
    ? config.anthropicApiKey
    : cloudflareEnv.NUXT_ANTHROPIC_API_KEY;
  return typeof value === "string" ? value.trim() : "";
}
