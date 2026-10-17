# ReferralReady

**Turns a 15–35 page scanned hospital referral packet into a source-linked admission recommendation a coordinator can verify in minutes, inside the 2-hour review window.**

## Team

- Team: Dawn Firefly (OC Impact Lab, Illumination Health + Home challenge)
- Members: _add names here_

## The problem

Illumination Health + Home (IHH) intake coordinators must review every recuperative-care referral within 2 hours. Packets arrive as long, faxed, partly redacted scans. The coordinator has to find dozens of facts (housing, cognition, ADLs, mobility, infections, required documents) and check them against a multi-page admission rulebook with precedence rules and case-by-case exceptions.

## What we built

- **Referral intake dashboard:** upload a packet, optional intake details, 2-hour countdown, status (Open / In review / Needs info / Approved / Denied), search, filters, sorting and Claude's suggested decision per row.
- **Decision processor:** PDF → forms → patient facts → IHH criteria as a connected graph, with every fact linked to its cited page.
- **Summary:** the recommendation and its reasons, discrepancies and gaps, the required documents checklist (DOC-1 to DOC-10) and the criteria by decision-tree stage, beside the PDF with the cited page opened.
- **Storage:** PDFs and saved analyses in Cloudflare R2 when deployed (local disk when run locally), so a packet is analyzed once.

## Demo video

_Add link here_

## How Claude is used

**While building:** Claude Code (and Codex) wrote and reviewed most of the code, tests and docs, under human direction.

**Inside the tool** (two passes per packet, `frontend/server/utils/run-analysis.ts`):
1. Claude reads the scanned PDF directly and returns forms, facts, page citations and approximate positions (structured JSON, schema-validated).
2. Claude reviews those facts against every IHH rule ID and returns met / not met / missing / uncertain with a note. A deterministic decision tree (`frontend/shared/decision-tree.ts`) turns the rule statuses into the recommendation.

**What a person checks:** every recommendation is a suggestion. The coordinator verifies each cited page, resolves uncertain and conflicting items, checks rules the packet cannot answer (e.g. the CalAIM 182-day cap), and sets the final status. The tool never admits or denies anyone, and nothing is sent to IHH or the referring hospital.

## Real vs. mocked

| Part | Status |
| --- | --- |
| PDF upload and storage (R2 / local disk) | Real |
| Claude reading the PDF and reviewing criteria | Real (needs `NUXT_ANTHROPIC_API_KEY`) |
| Decision tree and recommendation | Real, deterministic over Claude's rule statuses |
| Page citations | Real (model-reported) |
| Highlight boxes on the page | Real but approximate; often off (see below) |
| "Synthetic UI example" applicant | Mocked, fictional data |
| Draft hospital response | Not built (draft-only by design if added) |
| Connection to IHH systems, emails, faxes | None |
| Login | Cloudflare Access on the deployed site; none locally |

## Where it gets things wrong

- **Highlight positions are often wrong.** Packets are scanned images with no text layer, so the box comes from Claude estimating position by eye; we measured errors of 5–35% of page height. The cited page is reliable; the box is not.
- **Thin extraction on long packets** can mark many criteria "missing" when the facts are in the PDF. Re-run, or use a stronger extraction model (`NUXT_CLAUDE_EXTRACTION_MODEL`).
- **Redactions and conflicts** (e.g. a dementia code vs. an unchecked cognitive-impairment box) are deliberately left "uncertain" for the coordinator, so many packets come back "Needs review".
- **Slow PDF loading** on large scanned packets; analysis takes about 1.5–2.5 minutes and the tab must stay open.

## Next steps

- A dedicated page-by-page localization pass for accurate highlights.
- Draft hospital response (copy-only, never sent automatically).
- Background analysis that survives closing the tab (queue or Durable Object).
- Evaluation against more labelled packets, and coordinator feedback on rule wording.

## Data and privacy

- No referral packets, rendered pages, OCR text or screenshots of packets are in this repository or its history. Sample packets stay outside the repo; `*.pdf` and images are git-ignored.
- No API keys are committed; secrets come from environment variables (`frontend/.env.local` locally, Cloudflare Worker secrets in production).
- Packets are sent only to the Anthropic API for analysis and stored only in the team's private R2 bucket or the local `.data` folder.
- Nothing connects to IHH systems or sends messages.
- Historical IHH outcome labels are never used to drive or explain decisions.
- License: MIT (see `LICENSE`).

---

## Technical details

A local referral-review workspace: **one combined scanned PDF + patient name → document forms → patient facts → application requirements**.

Built with Nuxt 4, Vue 3, shadcn-vue and Vue Flow. The Nuxt server sends the PDF to Claude for visual analysis; a second Claude pass reviews the extracted evidence against the organizer's IHH adult criteria. No local OCR or PDF text extraction is used.

### Run

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

This is a prototype with same-origin mutation checks, Cloudflare Access enforcement for remote uploads/analysis, and explicit private PDF storage. It has no persistent applicant database or production clinical validation. Each Claude pass is a streamed Anthropic SDK request; the endpoint streams pass-level progress (NDJSON) to the browser and applies only a complete, validated result. Every endpoint (attachment, private storage, Claude analysis) accepts one PDF up to 50 MB. PDFs up to 20 MB are sent inline; larger ones are uploaded through Anthropic's Files API (Messages requests are capped at 32 MB after base64 encoding) and deleted after the analysis. One active analysis per server process, with a 15-minute timeout per Claude pass. Provider page/context limits also apply. **Stop waiting** cancels the browser request and aborts the server's in-flight Claude stream; tokens already generated are still billed.

## Checks

```sh
cd frontend
npm test
npm run typecheck
npm run build
```

Contract tests cover source/section/fact/rule links, invalid model output, missing/redacted evidence, precedence, recommendations and provider failures. Live model accuracy must be evaluated separately with a valid replacement key; historical outcome labels are never model inputs.

The only routes remain `/` (applicant dashboard), `/processor`, and `/summary`. See [the integration details](docs/claude-integration.md) and [page boundaries](docs/page-handoff.md).

Read [AGENTS.md](AGENTS.md), the relevant skill in [.agents/skills](.agents/skills), and [the Claude integration boundary](docs/claude-integration.md). The analysis provider is in `frontend/app/services/analysis.ts`; fixtures and state are separate from the screen.

Original referral packets, their contents, generated patient screenshots, credentials, and build output must stay out of Git. The supplied PDFs are external examples and are not included here.

## Three-page scaffold

- `/`: referral intake dashboard: summary counts, search, status/priority filters, sorting, inline review status (Open, In review, Needs info, Approved, Denied — set manually by the coordinator), and a 2-hour review countdown from the received time. **Add applicant** keeps one combined PDF in browser memory, starts Claude analysis immediately, and opens the processor. It does not upload to packet storage. Analysis failures appear in the processor with a retry action; the session applicant remains available until reload. Opening an *Open* referral marks it *In review*.
- `/processor`: the existing PDF → information nodes → checklist workspace.
- `/summary`: the active applicant's recommendation (from the decision model, else the staged decision tree over the checklist), discrepancies and gaps, required documents DOC-1–DOC-10, and criteria by decision-tree stage. Clicking any item opens its cited page in the PDF beside it, with the located passage highlighted. Read-only: the coordinator decides.

Use **Continue to summary** after analysis completes. Dashboard **Add applicant** and processor PDF uploads start foreground Claude analysis immediately. New dashboard applicants, their original PDFs, results, and review edits stay in browser memory across route navigation and reset on reload. Explicit **Save PDF to private storage** remains separate. Previously stored applicants still load from the server and can reuse their saved analyses. Page ownership and shared contracts are documented in [the page handoff](docs/page-handoff.md).

## Packet storage

**Add applicant** now starts a session-only analysis without calling these storage routes. The existing packet storage API remains available for previously stored applicants in `frontend/server/`:

| Route | Purpose |
| --- | --- |
| `GET /api/applicants` | List stored applicants |
| `POST /api/applicants` | Multipart `name` + `file`; stores the PDF |
| `GET /api/applicants/:id/pdf` | Stream the stored PDF to the processor preview |
| `PATCH /api/applicants/:id` | Update intake details or review status (JSON) |
| `POST /api/applicants/:id/analyze` | Run Claude on the stored PDF (streamed like `/api/analyze`) and save the result |
| `GET /api/applicants/:id/analysis` | The saved analysis result |
| `DELETE /api/applicants/:id` | Delete (local/R2) or move to Drive trash |

**On Cloudflare (the deployed site): R2.** `nuxt.config.ts` declares the R2 bucket `referralready` as the binding `REFERRAL_PACKETS`; Cloudflare's build turns that into the deployed Worker config, so no dashboard binding is needed. PDFs are stored at `packets/<id>.pdf`, saved analyses at `analyses/<id>.json`, and applicant details (with a short analysis summary) in a single `index.json`. Uploads are refused once stored PDFs would exceed `NUXT_STORAGE_LIMIT_GB` (default 9 GB, under R2's 10 GB free tier). Protect the site with Cloudflare Access before storing real referrals: these routes have no login of their own.

To test the Cloudflare build locally with a simulated bucket:

```sh
cd frontend
WORKERS_CI=1 NITRO_PRESET=cloudflare_module npx nuxt build
npx wrangler dev -c .output/server/wrangler.json
```

**Local development default: local disk.** With no configuration, PDFs and an `index.json` go to `frontend/.data/referrals/` (Git-ignored). This needs no setup but only lives on the machine running the server.

**Optional: Google Drive.** Copy `frontend/.env.example` to `frontend/.env` and fill in all four values; the server then stores and lists packets in one Drive folder (applicant metadata is kept in each file's `appProperties`), so everyone using that server sees the same list.

1. In Google Cloud Console, enable the **Google Drive API**, then create an OAuth client ID (type *Web application*) with `https://developers.google.com/oauthplayground` as an authorized redirect URI.
2. In the [OAuth Playground](https://developers.google.com/oauthplayground), open the settings gear, choose **Use your own OAuth credentials**, and enter the client ID and secret. Authorize the scope `https://www.googleapis.com/auth/drive`, then exchange the code for tokens and copy the **refresh token**. If the OAuth consent screen is in *Testing* mode, refresh tokens expire after 7 days; publish it, or regenerate the token when it expires.
3. Create a Drive folder and copy its ID from the URL (`drive.google.com/drive/folders/<FOLDER_ID>`). Shared drives work too.
4. Restart `npm run dev`. Upload responses show `"storage": "google_drive"`.

Referral packets contain patient information. Use a Drive account and folder your organization has approved for that data, keep sharing restricted, and never commit `.env`. There is no authentication on these routes: run the server only on a trusted machine or network.
