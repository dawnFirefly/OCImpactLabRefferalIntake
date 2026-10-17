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
| Highlight boxes on the page | Real but approximate |
| "Synthetic UI example" applicant | Mocked, fictional data |
| Draft hospital response | Not built (draft-only by design if added) |
| Connection to IHH systems, emails, faxes | None |
| Login | Cloudflare Access supported, but **temporarily off** on the deployed site (`NUXT_WORKSPACE_PUBLIC_ACCESS`); none locally |

## Where it gets things wrong

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

Built with Nuxt 4, Vue 3, [shadcn-vue](https://www.shadcn-vue.com/) and Vue Flow, deployed as a Cloudflare Worker: <https://ocimpactlabrefferalintake.notnaren.workers.dev>. No local OCR or PDF text extraction: Claude reads the PDF itself.

### Quick start

Node.js 26+ and npm.

```sh
cd frontend
npm ci
cp .env.example .env.local   # add a fresh Anthropic key to .env.local (ignored by Git)
npm run dev                  # http://127.0.0.1:3000
```

The **Synthetic flow** (fictional "Jane Doe" packet) works without a key. With a key, upload any combined referral PDF and analysis starts immediately.

### Pages

| Route | What it does |
| --- | --- |
| `/` | Intake dashboard. **Add applicant** takes one PDF plus intake details, starts analysis and opens the processor. |
| `/processor` | **Applicant PDF** (upload) · **Processor** graph (PDF → forms → facts) · **Application review** (IHH decision tree). |
| `/summary` | Read-only recommendation, gaps, required documents and criteria by stage, each linked to its cited page. |

### Analysis (two passes, streamed live)

1. **Upload** a PDF (up to 50 MB). The patient name is optional: Claude reads it from the packet; a dashboard name is cross-checked.
2. **Pass 1, Claude Haiku 5.5** (`NUXT_CLAUDE_EXTRACTION_MODEL`): forms/sections, facts, page citations, exact quotes and an approximate highlight box per quote.
3. **Pass 2, Claude Sonnet 5.5** (`NUXT_CLAUDE_REVIEW_MODEL`): every one of the 155 pinned IHH criteria.
4. Form and fact nodes pop into the graph and criteria fill in while Claude writes; all of it is labeled **provisional** until the complete result passes validation. On failure or **Stop analysis**, the previous workspace is restored.

The browser sends the raw PDF bytes (`POST /api/analyze`, `content-type: application/pdf`); the server passes it to Claude through Anthropic's **Files API** and deletes it afterwards. Validation repairs only drop data or lower certainty, never raise it, and are listed under **Validation repairs applied**.

### Navigation

- **Click a fact or form node** → Application review scrolls to and highlights the linked criteria (the PDF does not open).
- **Click a criterion** → the PDF opens on the right (PDF list hidden, graph narrowed), scrolled to the cited line and highlighted. The viewer scrolls continuously through all pages.
- Edits keep the original value, add an audit note, and mark the recommendation and linked criteria for recheck.

### Decision tree

Application review always shows the full rubric, before analysis too, organized by [`frontend/decisionTree.md`](frontend/decisionTree.md) and implemented in [`frontend/shared/decision-tree.ts`](frontend/shared/decision-tree.ts): 1 General & payer eligibility · 2 Safety, behavioral & cognitive · 3 Mobility & ADLs · 4 Medical stability & exclusions · 5 Conditional services · 6 Required documentation. Each stage shows Pass / Denied / Human review / Hold / Conditional / RFI / Needs review. OTH-2 and NEU-X6 route to human review, never auto-denial; missing documents give an RFI; missing evidence is never a denial. Criteria are the organizer's pinned [`admission-criteria.json`](frontend/shared/admission-criteria.json) with original IDs and precedence.

### Configuration

| Variable | Purpose |
| --- | --- |
| `NUXT_ANTHROPIC_API_KEY` | Claude key: ignored `.env.local` locally, Worker secret on Cloudflare. Never commit it. |
| `NUXT_CLAUDE_EXTRACTION_MODEL` / `NUXT_CLAUDE_REVIEW_MODEL` | Defaults `claude-haiku-5-5` / `claude-sonnet-5-5`. |
| `NUXT_WORKSPACE_ORIGIN`, `NUXT_CLOUDFLARE_ACCESS_*`, `NUXT_WORKSPACE_ALLOWED_EMAILS` | Remote access via Cloudflare Access. |
| `NUXT_WORKSPACE_PUBLIC_ACCESS` | **Temporary.** `true` skips the Access sign-in check (origin/hostname checks stay). Currently on in `wrangler.jsonc`. |
| `NUXT_STORAGE_LIMIT_GB` | Stored-PDF cap (default 9 GB). |
| `NUXT_GOOGLE_DRIVE_*` | Optional Drive packet storage for local servers. |

### Deploying to Cloudflare

`frontend/wrangler.jsonc` runs `npm run build:worker` before every deploy, so `npx wrangler deploy` works from a clean checkout and in Cloudflare's build. Pushing to `main` triggers a deploy.

```sh
cd frontend
npx wrangler login
npm run secret:claude   # NUXT_ANTHROPIC_API_KEY as a Worker secret (enter it at the prompt)
npx wrangler deploy
```

Workers Logs are enabled for per-request CPU and wall time. `public/local-demo` packets are excluded from builds.

### Known limits

- **Free plan CPU:** the account is on Workers Free (~10 ms CPU per request). Long analyses can occasionally fail with **Error 1102** ("connection closed"); retry, or move to Workers Paid and add `"limits": { "cpu_ms": 300000 }` to `wrangler.jsonc` (rejected on Free).
- **Sign-in is off:** anyone with the URL can upload PDFs and run paid analyses. To close it, enable Cloudflare Access on the workers.dev route, set `NUXT_CLOUDFLARE_ACCESS_AUDIENCE` to the Access app's AUD tag, and remove `NUXT_WORKSPACE_PUBLIC_ACCESS`.
- **One analysis at a time** per server instance; the lock expires after 4 minutes or when the browser disconnects. A concurrent upload gets "Another analysis is running": wait and retry.
- New applicants, results and edits live in browser memory and reset on reload; stored applicants and saved analyses persist.

### API and storage

| Route | Purpose |
| --- | --- |
| `POST /api/analyze` | Raw PDF body (`x-file-name`, optional `x-patient-name`); streams NDJSON progress, previews and one result |
| `GET /api/applicants` | List stored applicants |
| `POST /api/applicants` | Multipart `name` + `file`; stores the PDF |
| `GET /api/applicants/:id/pdf` | Stored PDF (range requests) |
| `PATCH /api/applicants/:id` | Update intake details or review status |
| `POST /api/applicants/:id/analyze` | Analyze a stored PDF and save the result |
| `GET /api/applicants/:id/analysis` | Saved analysis |
| `DELETE /api/applicants/:id` | Delete |
| `POST /api/packets` | Explicit **Save PDF to private storage** |

Backends: **R2** on Cloudflare (bucket `referralready`: `packets/<id>.pdf`, `analyses/<id>.json`, `index.json`); **local disk** by default in development (`frontend/.data/referrals/`, Git-ignored); or **Google Drive** when all `NUXT_GOOGLE_DRIVE_*` values are set (OAuth client + refresh token from the OAuth Playground with the `drive` scope; use a restricted folder approved for patient data). Test the Worker build with a simulated bucket: `npm run build:worker`, then `npm run preview:worker`.

### Local example packets

```sh
node scripts/link-demo-pdfs.mjs /path/to/referral-packets
```

Creates ignored symlinks and a manifest in `frontend/public/local-demo/`, so R01–R11 appear as separate applicants on localhost. They never auto-analyze (use **Analyze with Claude**); R01 starts with a labeled inventory-only mock review.

### Checks

```sh
cd frontend
npm test          # contracts, decision tree, streaming scanner, storage, access, credentials
npm run typecheck
npm run build
```

More detail: [AGENTS.md](AGENTS.md), [Claude integration](docs/claude-integration.md), [page handoff](docs/page-handoff.md).
