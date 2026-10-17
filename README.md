# ReferralReady · frontend scaffold

A minimal referral-review workspace: **PDF files → connected patient-information nodes → result checklist**.

Built with **Nuxt 4, Vue 3, shadcn-vue, Tailwind CSS, and Vue Flow**. This deliverable is frontend-only. Claude document analysis will be connected in a later task. No backend or API key is required.

## Run

Use Node.js 26+ (Nuxt also supports Node 22.22.3+ and 24.15.0+) and npm.

```sh
cd frontend
npm ci
npm run dev
```

Open [localhost:3000](http://127.0.0.1:3000).

## What works

- Three-panel workspace with synthetic, clearly labeled example data.
- Many source PDFs linked to one information node, and nodes linked to checklist items.
- Graph selection, pan, zoom, category filtering, and node paging.
- Checklist expansion, completion counts, and session-local status adjustments.
- Information review/correction with original values preserved.
- Browser-local PDF attachments and PDF preview, with an explicit **Awaiting Claude** state.
- Clickable document previews, page navigation, and highlighted source sections in the review dialog. The synthetic PDFs and their exact anchors are generated together in the browser.

PDF.js renders PDFs locally for display; it does not extract patient facts or perform OCR. Documents are not analyzed or uploaded. Model analysis, persistent storage, and admission decisions are not implemented. Uploaded PDFs can be previewed; real evidence highlights require anchors from the future Claude integration. Refreshing resets the frontend demo.

## Checks

```sh
cd frontend
npm run typecheck
npm run build
```

## Continue with another agent

Read [AGENTS.md](AGENTS.md), the relevant skill in [.agents/skills](.agents/skills), and [the Claude integration boundary](docs/claude-integration.md). The future provider interface is in `frontend/app/services/analysis.ts`; fixtures and state are separate from the screen.

Original referral packets, their contents, generated patient screenshots, credentials, and build output must stay out of Git. The supplied PDFs are external examples and are not included here.
