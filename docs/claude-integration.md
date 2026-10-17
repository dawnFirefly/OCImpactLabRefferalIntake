# Claude PDF analysis

## Implemented flow

The current task authorizes a Nuxt server backend. `frontend/server/api/analyze.post.ts` accepts one multipart `pdf` and `patientName`. A browser attachment/preview alone never starts analysis. `frontend/app/services/analysis.ts` supplies the client provider; `useReviewWorkspace.ts` applies only the completed result to the originating applicant and retains the browser PDF URL.

The first Claude Messages request sends the original scanned PDF as a base64 document and asks for logical forms/sections, dated facts, and physical-page quotes. The second request sends the validated extraction and the pinned organizer criteria for a complete rule review. Both requests use JSON structured outputs, then local Zod and cross-reference validation. No local OCR, text extraction, document splitting or PDF rewriting occurs.

Set `NUXT_ANTHROPIC_API_KEY` in ignored `frontend/.env.local` (run dev (the dev script loads `.env.local`)) or the server environment; never use public runtime config. Two models, configurable separately: `NUXT_CLAUDE_EXTRACTION_MODEL` (default `claude-haiku-5-5`, effort medium) reads the PDF, finds forms/facts and approximate highlight boxes; `NUXT_CLAUDE_REVIEW_MODEL` (default `claude-sonnet-5-5`, effort high) links facts to every admission criterion. Calls use the official `@anthropic-ai/sdk` with streaming and adaptive thinking; non-Haiku calls enable server-side refusal fallback (`fallbacks: "default"`).

**Live streaming.** The endpoint returns NDJSON: `progress`, provisional `section` / `fact` (with its evidence) / `criteria` / `rule` events parsed incrementally from Claude's structured output (`server/utils/stream-json.ts`), then one `result` or `error`. The extraction schema orders `sections` before self-contained `facts` (evidence inline, IDs assigned server-side) so each node can be shown as soon as it closes. Preview nodes are shape-checked only and labeled provisional; the browser restores the prior workspace if the final validated result fails or is cancelled. Closing the request aborts the Claude stream.

The endpoint accepts same-origin loopback requests, or the configured HTTPS workspace with verified Cloudflare Access JWTs (issuer, audience, expiry, signature and allowed email), requires a bounded content length, enforces a 20 MB PDF limit and PDF signature check, and allows one analysis per process. Provider bodies and validation details are not echoed to the browser or logged by application code. Responses use `Cache-Control: no-store`. The user authorized Cloudflare Access for `vivianchih19@gmail.com` and explicit private R2 PDF storage. Remote access fails closed without its configured origin, team domain, audience and email allowlist. There is no separate application login route or applicant database.

**Cloudflare credential boundary.** `npm run build:worker` builds the Nitro `cloudflare_module` preset; `wrangler.jsonc` targets the existing `ocimpactlabrefferalintake` Worker. Set `NUXT_ANTHROPIC_API_KEY` as a runtime Worker **Secret** with `npm run secret:claude` or the Cloudflare dashboard, never as a plaintext `vars` entry or build secret. The server's credential helper reads the request's Cloudflare binding exclusively on Workers and uses private Nuxt config for local requests. An absent/invalid Worker binding cannot fall back to a development or build key. `.dev.vars` and Wrangler state are ignored. Tests cover this boundary; Worker dry-run verifies bundling. A secret alone does not enable remote analysis: the request must pass `workspace-access.ts`. Remote configuration uses `NUXT_WORKSPACE_ORIGIN`, `NUXT_CLOUDFLARE_ACCESS_TEAM_DOMAIN`, `NUXT_CLOUDFLARE_ACCESS_AUDIENCE` and comma-separated `NUXT_WORKSPACE_ALLOWED_EMAILS`. The edge policy and the server-side checks must agree. The module-level concurrency guard is per isolate, not account-wide. No real packet is automatically analyzed during deployment or verification.

## Result contract

`Referral` in `frontend/app/types.ts` remains the screen contract:

- Exactly one original `PacketDocument`.
- `DocumentSection`: a logical form, its source document, category, pages and found/missing/uncertain state. Missing placeholders have no invented pages.
- `Fact.section_ids` connects forms to facts; `Fact.evidence_ids` connects readable facts to quotes on pages in those forms.
- `Evidence.document_id` points to the PDF; `page` is one-based. `bbox` is Claude's visual estimate of the quote's position as `[left, top, right, bottom]` page fractions, or `null`. Boxes are sanity-checked (`sanitizeBox`) and otherwise dropped to a page-only citation; the UI labels them approximate. There is no text-layer or pixel-level verification of quotes or boxes.
- `Fact.rule_ids` and `Rule.fact_ids` are built consistently on the server.
- `original_value` survives coordinator edits. Edits invalidate prior recommendations and affected rule statuses.
- `recommendation` is a coordinator-facing suggestion with supporting rule IDs and reasons, never an autonomous final admission action.

Malformed output (schema violations) rejects the analysis. Cross-reference problems are repaired conservatively and tallied in a `validation_repair` audit entry shown under the recommendation: out-of-range/empty citations and unknown links are dropped, a citation on another form's page links that form, duplicate IDs are renamed, unsupported found facts and absent facts with values become uncertain, and missing rule assessments become uncertain. Repairs never raise certainty. The rejection reason shown to the coordinator contains rule names or schema paths only, never document values.

## Criteria and semantics

The public organizer's [adult criteria JSON](https://github.com/travcjohnson/claude-impact-lab-oc/blob/main/challenges/1-referral-intake/criteria/admission-criteria.json) is pinned from criteria blob `501ba346b9679e7bbb11c1a07f71bfeabc8d69fd` in `frontend/shared/admission-criteria.json`. It contains the internal outline, general OR conditions, system-specific examples, document checklist and form screen. Original rule IDs, wording and precedence are preserved. Historical outcomes are not included. Pediatric criteria are not implemented; adult applicability must be established during review.

The evaluation prompt distinguishes `met`, `not_met`, `missing`, `uncertain`, and `not_applicable`. For exclusion rules, `not_met` means an exclusion is present; `met` means evidence supports its absence. Missing evidence is unknown, not a proven failure. A diagnosis mention or unselected checkbox does not establish a condition. Redactions are intentionally withheld. Differing dated observations remain separate; conflicts require review. The internal outline overrides the form, including wheelchair transfer eligibility and case-by-case sex-offender review. Conditional arrangements need positive evidence.

The recommendation follows the staged decision tree in `frontend/shared/decision-tree.ts` (from `frontend/decisionTree.md`): a confirmed exclusion denies at its stage; OTH-2/NEU-X6 route to human review; MH-4 holds; unmet conditional arrangements give conditional approval pending arrangements; missing documents give an RFI; missing evidence for a clinical gate is "needs review", never a denial. The CalAIM 182-day cap (Stage 1.2) has no source rule ID and is a coordinator check. The model still determines clinical applicability and evidence interpretation: this has not been clinically validated.

## Local examples and verification

`scripts/link-demo-pdfs.mjs` links each local Rxx packet as a separate applicant, without reading its content. Selection and preview remain local. Analyze explicitly sends that one packet. Nitro excludes `local-demo` from production assets. R01's pre-analysis mock uses the supplied document inventory only; other packets are pending. Synthetic examples remain fictional and separate.

`npm test` checks contracts, missing/conflicting/redacted handling, precedence, source links, recommendations, and transport errors with fictional data and mocked transport. Browser verification exercises form nodes, yellow dashed links, correction invalidation, responsive layout, and analysis result/error UI. Live Anthropic responses and accuracy on real packets are not verified without a replacement credential. Pass-level progress streaming is implemented; no database, final-decision workflow or generated summary has been added.

API references: [PDF document input](https://platform.claude.com/docs/en/build-with-claude/pdf-support) and [JSON structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs).

## Explicit private PDF storage

The user authorized the existing `referralready` bucket via the `REFERRAL_PDFS` Worker binding. `POST /api/packets` accepts one multipart `pdf`, checks the shared workspace access boundary and the 50 MB/signature constraints, and awaits R2 confirmation before returning an opaque storage receipt. It stores the exact uploaded bytes under `packets/<UUID>.pdf`, with PDF content type only; no patient names, source filenames, extracted text, public URLs or analysis results are stored as metadata. Provider errors are replaced with a data-free message. No list/download/delete API or public bucket access is added.

The processor's **Save PDF to private storage** button is the only R2 upload trigger. Attachment, preview, applicant selection and Claude analysis never automatically save to R2. A receipt stays on the document through analysis in this browser session. Stored PDF bytes outlive the browser session; applicant records and receipts are not reloaded after refresh. Retention/deletion currently require the bucket administrator. Local Wrangler preview uses emulated R2; tests use fictional data only. The tracked `.env` contains only an empty variable declaration; optional development credentials must use an ignored file or environment.

Attachments and R2 saving accept one PDF up to 50 MiB (labeled 50 MB in the UI). The existing inline base64 Claude path retains a separate 20 MiB PDF limit to stay below Anthropic's 32 MB request ceiling including encoding and prompts. Larger PDFs remain attachable and saveable; analysis fails before a provider call with a clear explanation. Supporting their analysis requires a Files API integration; it is not silently claimed here.
