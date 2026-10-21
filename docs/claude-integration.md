# AI integration

The application now supports Cloudflare Workers AI (default), Anthropic and OpenCode. See [README](../README.md) for setup, supported input limits and account/deployment limitations.

## Orchestration

`server/utils/ai-provider.ts` resolves the selected provider, optional request-scoped user key, private runtime secrets and model IDs. Worker credentials come from that request's bindings, never a build-time development fallback. Provider endpoints are fixed; user input cannot supply arbitrary URLs. Responses/errors never echo provider bodies or credentials.

`server/utils/run-analysis.ts` maintains the NDJSON progress/preview/result/error contract. Anthropic retains two-pass streamed PDF extraction through its Files API and criteria review. Cloudflare/OpenCode use `vision-analysis.ts`: PDF.js-rendered JPEG pages are read independently, IDs are namespaced per physical page, then criteria are evaluated in bounded batches. Cloudflare uses its AI binding by default; REST with a user token/account ID is optional. OpenCode uses its official OpenAI-compatible chat endpoint and requires a vision-capable extraction model.

The browser renders pages without local OCR/text extraction. Whole original PDFs remain unchanged in private storage. Scanned images are downscaled for provider limits; faint/small print can remain uncertain. Empty or malformed model output never becomes an authoritative result. Physical pages are assigned by render order. Quotes and highlight boxes still need coordinator verification.

`analysis-contract.ts` validates the extraction and evidence references, applies conservative repairs, reconciles rule IDs and derives the deterministic IHH adult recommendation. Missing/redacted/conflicting evidence stays uncertain. The pinned criteria and their precedence remain unchanged. Historical IHH outcome labels never drive predictions or rationales; coordinator review remains required.

## Persistence

Analysis of a stored applicant saves its complete workspace and analysis metadata before returning a successful result. Conditional revisions prevent an in-flight result from replacing a review changed in another tab. Reanalysis is refused when the saved record contains human fact/rule edits; create a separate applicant to rerun it. Human adjustments preserve original values, append audit records, invalidate recommendations and save through the workspace API.

Every applicant API uses the same access middleware. Same-origin GET/PDF requests may omit Origin, while mutations require Origin. Remote requests require verified Cloudflare Access unless the explicitly configured public demo mode is enabled. See README: the existing deployment's public-mode setting is retained and must be changed before private use.

The per-instance concurrency lock expires and has an owner token so cancellation/late cleanup cannot release another job's lock. It is not account-wide. Binding inference cannot be interrupted mid-call; cancellation suppresses subsequent calls/results. Closing the browser still cancels a request; durable jobs are not implemented.

## Verification

Use fictional fixtures only. Tests cover malformed outputs, missing/conflicting/redacted evidence, precedence, reference integrity, provider transport/errors, and complete per-applicant persistence. Browser checks cover edits, source links, hidden graph nodes, layout restoration, direct links and summaries. Build/dry-run checks verify bundling, not live model availability or clinical accuracy.
