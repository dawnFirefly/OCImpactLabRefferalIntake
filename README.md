# Referral Intake

A **one-day hackathon prototype** for reviewing hospital referral PDFs against recuperative-care admission criteria, with source-linked AI suggestions and coordinator review.

Built by Team Eureka for the OC Impact Lab Illumination Health + Home challenge.

## What it does

- **Applicant dashboard:** upload one combined PDF, record intake details, search/filter applicants, track the two-hour review window, and record the coordinator's status.
- **Processor:** review the complete PDF → form/section → patient fact → admission requirement graph. Open cited pages and save corrections and notes on the specific patient/item.
- **Persistence:** applicants, original PDFs, analyses, all graph entities/references, corrections, audit entries, dragged node positions, and viewport survive refresh. Hidden/paginated nodes remain in the saved graph.
- **Summary:** read-only recommendation, evidence gaps, required documents, and criteria by decision stage. Direct processor/summary links include the applicant ID.
- **AI settings on the homepage:** Cloudflare Workers AI by default; optional Anthropic and OpenCode models and personal API keys. Keys stay in browser memory for the open session and are sent only to this app's server for the selected provider.

The coordinator verifies citations, resolves uncertainty, and makes the final decision. Model output never automatically changes the coordinator's Approved/Denied status or sends messages to a hospital. This hackathon prototype has not been clinically validated.

## Run locally

Node.js 24+ and npm:

```sh
cd frontend
npm ci
cp .env.example .env.local
npm run dev
```

Open `http://127.0.0.1:3000`. Fictional demo mode and persistent local PDF/review storage work without AI credentials. Live inference requires the selected provider's credentials or the deployed Workers AI binding. Local applicant/workspace data stays in ignored `frontend/.data/referrals`.

## Providers

| Provider | Credentials | Document input |
| --- | --- | --- |
| **Cloudflare Workers AI (default)** | Deployed `AI` binding; or your Workers AI token and account ID in homepage settings/private environment variables | Browser-rendered JPEG pages; vision extraction followed by criteria evaluation |
| Anthropic | Your key in homepage settings or private `NUXT_ANTHROPIC_API_KEY` | Original PDF via Anthropic Files API, deleted from that API after analysis |
| OpenCode | Your key and compatible model IDs in homepage settings or private `NUXT_OPENCODE_*` variables | Browser-rendered page images through OpenCode's OpenAI-compatible chat endpoint; extraction model must support images |

Cloudflare defaults: `@cf/meta/llama-3.2-11b-vision-instruct` for page extraction, `@cf/meta/llama-3.3-70b-instruct-fp8-fast` for criteria review. Models must be enabled/available for your account; some require accepting the model license. An unsuccessful connection test never falls back to a different provider.

PDF upload/storage accepts one valid combined PDF up to 50 MiB. Cloudflare/OpenCode additionally limit vision analysis to 60 pages and 24 MiB of rendered request data. Rendering is performed by PDF.js in the browser; text recognition happens at the selected AI provider, with no local OCR dependency. Image downscaling can reduce readability on small/faint text. Use a stronger vision model or review the original when evidence is uncertain. Anthropic retains its provider-specific page/request limits.

All providers pass the existing schema/reference validation and deterministic adult IHH decision tree. Physical page numbers in the page-image pipeline come from PDF.js page order, not model guesses. Quotes and optional highlight boxes remain model-reported and require verification. No automatic clinical accuracy claim is made.

## Saved reviews

Private R2 is used on Cloudflare through `REFERRAL_PACKETS` (the existing `referralready` bucket). Local development uses disk. New uploads save the PDF/intake before analysis, including uploads directly in `/processor`.

`GET/PUT /api/applicants/:id/workspace` reads/writes a versioned complete graph. Canonical document/section/fact/evidence/rule references reconstruct every link; saving does not depend on the current canvas page. Node positions and viewport are stored separately from domain facts. Temporary blob URLs, selected-node highlights, and credentials are excluded.

Review saves show Saving, Saved, or an actionable error. Conditional revisions reject stale writes from another tab. Pending/failed saves block internal navigation and trigger a browser warning on tab close. A failed save leaves the user's edits in the open tab; retry before leaving. For a revision conflict, preserve any needed unsaved text and reload the applicant to load the latest review. Legacy stored analyses load automatically on first review.

Reanalysis of a packet with coordinator fact/rule edits is blocked to protect those edits; add a separate applicant for another analysis. Deleting an applicant erases its PDF, analysis and current workspace; a data-free deletion marker prevents stale writes from restoring the review.

Google Drive remains readable for legacy packets/intake, but new persistent reviews require R2 or local disk. New uploads/analyses using Drive are rejected explicitly rather than pretending reviews were saved. Local disk writes are serialized within one Node process; use R2 for multiple instances.

## Cloudflare deployment and MCP

The [project MCP configuration](.codex/config.toml) registers Cloudflare's official API/documentation servers. See [MCP setup and repair plan](docs/repair-plan.md). The documentation MCP was exercised during implementation. Global MCP registration in the managed environment was blocked by its read-only Codex directory; account OAuth must be completed in a writable Codex client before account-level MCP operations work.

```sh
cd frontend
npm run build:worker
npm run preview:worker
npm run deploy:worker
```

Wrangler and Nitro both declare `AI`, `REFERRAL_PACKETS`, and `REFERRAL_PDFS`. The existing Worker name/URL are retained: `https://ocimpactlabrefferalintake.notnaren.workers.dev`.

All API endpoints enforce the shared workspace access boundary. Localhost is allowed; remote access requires the configured HTTPS origin and verified Cloudflare Access identity unless explicit public demo mode is enabled. **The tracked deployment currently retains `NUXT_WORKSPACE_PUBLIC_ACCESS=true`**, matching the prior deployment. Set it to `false` and configure Access before using private patient packets. Public mode shares applicant records with anyone who can access the deployment.

Keep tokens in Worker secrets/private local environment variables; never put them in Wrangler `vars`, public Nuxt config, source, screenshots, or patient records. The Workers AI binding needs no app-user API key.

Long analysis requests require suitable Worker CPU/wall-time limits. Workers Free's CPU budget may reject large scans; verify under your account and workload before deployment. Analysis still depends on an open browser request; the current queue is not a durable background job. No live Cloudflare/Anthropic/OpenCode inference or production deployment was performed in this change.

## Validation and remaining limits

```sh
cd frontend
npm test
npm run typecheck
npm run build
npm run build:worker
npx wrangler deploy --dry-run
```

Tests cover evidence/rule semantics, malformed provider results, provider transport, complete graph persistence, patient isolation, stale writes, deletion, and access controls, using fictional fixtures and mocked inference. Browser checks exercise separate patient notes, hidden nodes, graph positions, refresh/direct links, summary navigation, session-only credentials, and compact layouts.

Real-packet accuracy and account-specific provider availability require separate verification. There is no IHH-system integration, automated admission action, outbound messaging, or guaranteed background completion after closing the tab.

MIT license; see [LICENSE](LICENSE).
