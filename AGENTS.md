# ReferralReady agent handoff

## Current scope and user decisions

The user has now authorized **a local Nuxt server backend for Claude PDF analysis**. The processor accepts one scanned PDF and patient name, organizes document sections and facts, and returns a coordinator-facing application recommendation. The user subsequently authorized Cloudflare Worker secrets, the existing `referralready` R2 bucket, explicit PDF saving, and Cloudflare Access restricted to `vivianchih19@gmail.com`. Local OCR remains out of scope.

- Keep the minimal three-section workspace: one applicant PDF on the left, connected PDF → form/section → patient-fact nodes in the middle, result checklist on the right.
- Use Vue 3 / Nuxt 4 and actual shadcn-vue components. Vue Flow owns graph layout, pan, zoom, and source-to-fact edges.
- The user authorized three routes only: applicant dashboard, existing decision processor, and placeholder summary. Keep the dashboard/summary skeletal; use Cloudflare Access for remote access without adding application login routes, admission automation, or a Python backend.
- Do not implement or install local OCR, Tesseract, PDF text extraction, or image-based extraction. Do not extract the supplied packets as part of frontend work.
- Do not mistake mock fixtures for analysis. Uploading a PDF in the processor is the user's explicit request to analyze it: the upload starts Claude analysis immediately, with no patient name required (Claude reads the name; identity is cross-checked only when a dashboard applicant name exists). Previews of provided local packets (R01–R11) never auto-analyze; they use the Analyze with Claude button. Save PDF to private storage (private R2) stays a separate explicit action.

## Start here

```sh
cd frontend
npm ci
npm run dev
```

Development URL: `http://127.0.0.1:3000`. Synthetic mode needs no key. Live analysis needs server-only `NUXT_ANTHROPIC_API_KEY`; see `frontend/.env.example`. The tracked `frontend/.env` contains an empty variable declaration only; use ignored `.env.local` (the dev script loads `.env.local`) for optional local credentials. Never save a key pasted in chat.

Before delivery: `npm test`, `npm run typecheck` and `npm run build` from `frontend/`. For UI changes, render the actual screen and check the relevant interaction. Keep these commands and the README accurate.

## Architecture

- `frontend/app/app.vue`: root session provider and Nuxt router outlet.
- `frontend/app/layouts/default.vue`: lightweight shared navigation.
- `frontend/app/pages/index.vue`: applicant dashboard skeleton and session-local creation.
- `frontend/app/pages/processor.vue`: processor route and summary continuation.
- `frontend/app/components/DecisionProcessor.vue`: three panels, graph, checklist. Clicking a fact or form node never opens the PDF: it scrolls Application review to the linked requirements and flashes them. Clicking a requirement card (or the PDF row) switches to review mode: the PDF list hides, the graph narrows, and `SourceReviewPanel.vue` shows the continuous PDF scrolled to the cited line and highlighted (the originating fact's quote first), with the adjustment form.
- `frontend/app/pages/summary.vue`: placeholder sections only; no decision generation.
- `docs/page-handoff.md`: page ownership boundaries and shared state contract.
- `frontend/app/composables/useReviewWorkspace.ts`: session-local attachment and review state.
- `frontend/app/data/demo.ts`: explicitly synthetic fixtures, separate from real packets.
- `frontend/app/types.ts`: the graph/evidence/checklist result contract.
- `frontend/app/services/analysis.ts`: multipart client `AnalysisProvider`, taking one `File` and patient name.
- `frontend/server/api/analyze.post.ts`: same-origin analysis endpoint; remote requests require a verified Cloudflare Access JWT and configured origin/email; server credentials only.
- `frontend/server/api/packets.post.ts`: explicit one-PDF upload to private `REFERRAL_PDFS` / `referralready` R2 storage; same access boundary as analysis.
- `frontend/server/utils/`: two-pass Claude orchestration, schema/reference validation, and recommendation gate.
- `frontend/shared/admission-criteria.json`: pinned public organizer criteria, original rule IDs and precedence.
- `frontend/shared/decision-tree.ts`: the staged IHH decision tree from `frontend/decisionTree.md` (6 stages → steps → source rule IDs, each placed exactly once), step/stage outcome logic, and the full unreviewed rubric. Shared by Application review (always shows every criterion, before analysis too) and the server recommendation.
- `frontend/app/components/SourceReviewPanel.vue`: right-side source review (citations, continuous PDF, collapsible adjust form). Replaces the former dialogs.
- `frontend/app/components/PdfSourceViewer.client.vue`: browser-only continuous PDF.js viewer (all pages stacked, lazily rendered/released), cited-page outlines and normalized highlight overlay; no text extraction or OCR.
- `frontend/app/lib/demoPdf.ts`: runtime generation of fictional PDFs matching the authored demo anchors. Do not replace these with real packet content.
- `frontend/app/components/ui/`: source-owned shadcn-vue components generated by its CLI.
- `frontend/app/assets/css/main.css`: minimal workspace appearance and responsive layout.
- `docs/claude-integration.md`: implemented integration boundary and current limitations.

Keep service orchestration outside graph templates. An eventual model response should update the typed workspace rather than introduce a second UI model. Preserve original source values when a coordinator edits extracted information.

## Project skills

Read the relevant project skill when continuing work:

- UI, graph, or checklist work: [referral-frontend](.agents/skills/referral-frontend/SKILL.md).
- Claude integration work: [referral-claude-handoff](.agents/skills/referral-claude-handoff/SKILL.md).

## Data and decision semantics

The original R01/R02 packets are external files, not repository fixtures. Do not commit PDFs, screenshots of real packets, extracted packet text, credentials, or patient data. Keep fixtures fictional. Blacked-out data in the challenge examples means redacted for privacy, not missing.

For explicitly requested local packet previews, `scripts/link-demo-pdfs.mjs` creates ignored symlinks and a metadata manifest in `frontend/public/local-demo/`. R01–R11 remain separate referrals. The UI discovers these on mount and offers a switch back to the synthetic flow. R01 has an explicitly labeled mock review based only on the user-supplied packet inventory in `data/r01Mock.ts`. No patient values, verified page citations, or highlights are fabricated. Other packets remain pending until explicitly analyzed. Never assign fictional patient facts/anchors to a real packet. Nitro excludes local-demo assets from production output; verify that before distributing a build.

Historical labels supplied by IHH are evaluation outcomes; reasons were not recorded. They must not be used to fabricate rationales or hardcode model decisions. Distinguish evidence found, not found, conflicting, and coordinator-confirmed. A checklist count is not a clinical admission decision.

The challenge's official criteria are linked in `docs/claude-integration.md`. When later implementing rule review, preserve source rule IDs and their stated precedence, including case-by-case decisions and conditional requirements.

## Git

Do not commit generated dependencies, `.nuxt`, `.output`, local attachments, or secrets. This file does not authorize additional pushes or communications beyond the user's task. Follow the user's commit-signing instructions when making authorized commits; never expose private signing keys.

## Single-packet invariant

One applicant has exactly one combined PDF containing all document sections. R01 and R02 are separate selectable applicants. Uploads replace the active applicant with one PDF; reject multi-file drops. Repeated facts may cite several pages of the same packet. The future provider takes one `File`.
