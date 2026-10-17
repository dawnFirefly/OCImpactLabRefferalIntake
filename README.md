# ReferralReady

A local referral-review workspace: **one combined scanned PDF + patient name → document forms → patient facts → application requirements**.

Built with Nuxt 4, Vue 3, shadcn-vue and Vue Flow. The Nuxt server sends the PDF to Claude for visual analysis; a second Claude pass reviews the extracted evidence against the organizer's IHH adult criteria. No local OCR or PDF text extraction is used.

## Run

Use Node.js 26+ and npm.

```sh
cd frontend
npm ci
npm run dev
# Optional local Claude calls: create ignored .env.local from .env.example,
# add a fresh key there, then use npm run dev
```

Open [the processor](http://127.0.0.1:3000/processor). The synthetic flow works without credentials. Create an applicant or replace the sample PDF, enter the patient's name, and select **Analyze with Claude**. Analysis explicitly sends the name and original PDF to Anthropic. There is no automatic upload on attachment, preview, or applicant selection. The key is server-only and never requested by the browser. The tracked `.env` is an empty variable declaration only; never put a real key in that tracked file.

`NUXT_CLAUDE_EXTRACTION_MODEL` (default `claude-haiku-5-5`) reads the PDF and streams forms, facts and approximate highlight positions; `NUXT_CLAUDE_REVIEW_MODEL` (default `claude-sonnet-5-5`) links facts to the admission criteria. Nodes and checklist results appear live while Claude writes and are provisional until the full result validates. Restart the server after changing environment settings. Do not reuse an API key exposed in chat.

## Cloudflare Worker secrets and build

The Worker target is `ocimpactlabrefferalintake`. Its secret is supplied at request time through `event.context.cloudflare.env.NUXT_ANTHROPIC_API_KEY`; local Nuxt development uses private runtime config. A missing Worker binding fails closed, without falling back to a local/build credential.

```sh
cd frontend
npm run build:worker
npx wrangler deploy --dry-run
# Sign in, then enter the key at Wrangler's prompt (never in the command itself).
npx wrangler login --use-keyring
npm run secret:claude
```

Alternatively add `NUXT_ANTHROPIC_API_KEY` with type **Secret** under the Worker's **Settings → Runtime variables and secrets → Production**. This is a runtime secret, not a build variable. Keep its value out of `wrangler.jsonc`, Git, logs, and `runtimeConfig.public`. Local Wrangler preview secrets belong in an ignored `.dev.vars`; optional local Nuxt credentials belong in ignored `.env.local` with `npm run dev`. The tracked `.env` must stay empty.

`npm run deploy:worker` builds for Workers and then deploys. The mutation endpoints allow same-origin localhost development; remote requests require the configured HTTPS workspace origin and a verified Cloudflare Access JWT with the configured issuer, audience, expiry and allowed email. Missing Access configuration fails closed. The current in-memory concurrency guard is per Worker isolate, not a global spending limit. This checkout must be reviewed against the production branch before replacing the existing deployed app. Production builds exclude `public/local-demo` packets.

Cloudflare MCP is an agent-side account-management connection; it is not a runtime dependency and does not carry the Claude key to the browser. The server accesses its own Worker secret directly.

For local R2 verification, run `npm run build:worker` then `npm run preview:worker -- --env-file .env.example --port 8787`. Wrangler uses a local emulated R2 bucket by default, so test uploads do not reach production. A normal `npm run dev` has no R2 binding and returns a clear storage-unavailable error. No S3 access key or public bucket URL is needed.

## Local example packets

```sh
node scripts/link-demo-pdfs.mjs /path/to/referral-packets
```

This discovers `R01.pdf`-style files and creates ignored symlinks and a manifest in `frontend/public/local-demo/`. Each packet is a separate applicant. It does not copy or analyze their contents. Pick an applicant, enter a name, and explicitly select Analyze to send that packet to Claude. R01 initially retains its clearly labeled inventory-only mock review; other packets start pending. Choose **Synthetic flow** for fictional facts and authored source highlights.

Local packets are excluded from production output by Nitro's ignore configuration. Keep original packets, packet screenshots, extracted values and credentials out of Git. Applicant records, analysis results and edits remain in browser memory and reset on reload. An explicit **Save PDF to private storage** action persists the original PDF in the private `referralready` R2 bucket, using the `REFERRAL_PDFS` binding. Attaching, previewing and analyzing do not save a PDF to R2. Keys are random `packets/<UUID>.pdf` paths; patient names and source filenames are not stored in keys or metadata. Saved PDFs remain in the bucket after the browser session ends; the current dashboard does not reload saved applicants. Bucket retention and deletion are managed in Cloudflare.

## Review behavior

- Forms are logical sections within the original PDF, with page ranges and links to individual facts.
- Red marks missing evidence or an unmet requirement; yellow dashed links mark uncertain, conflicting or redacted findings.
- Every readable fact cites a PDF page and model-reported quote. Claude-located highlight boxes are approximate and labeled as such; verify the page and quote manually.
- Source criteria IDs and internal-outline precedence are preserved, including conditional arrangements, general eligibility alternatives and case-by-case reviews.
- Recommendations are **approval**, **not approved**, or **more information needed**. A coordinator confirms the final decision. Missing evidence is not an automatic denial. The completed count is not an admission decision.
- Corrections preserve original values, add session audit notes, and invalidate the recommendation and affected rule assessments until reviewed.

This is a prototype with same-origin mutation checks, Cloudflare Access enforcement for remote uploads/analysis, and explicit private PDF storage. It has no persistent applicant database or production clinical validation. Each Claude pass is a streamed Anthropic SDK request; the endpoint streams pass-level progress (NDJSON) to the browser and applies only a complete, validated result. Attachment and private storage accept one PDF up to 50 MB. The inline Claude analysis request limit remains 20 MB to fit Anthropic's 32 MB request ceiling after base64 encoding, one active analysis per server process, with a 15-minute timeout per Claude pass. Provider page/context limits also apply. **Stop waiting** cancels the browser request and aborts the server's in-flight Claude stream; tokens already generated are still billed.

## Checks

```sh
cd frontend
npm test
npm run typecheck
npm run build
```

Contract tests cover source/section/fact/rule links, invalid model output, missing/redacted evidence, precedence, recommendations and provider failures. Live model accuracy must be evaluated separately with a valid replacement key; historical outcome labels are never model inputs.

The only routes remain `/` (skeletal applicant dashboard), `/processor`, and `/summary` (placeholder). See [the integration details](docs/claude-integration.md) and [page boundaries](docs/page-handoff.md).
