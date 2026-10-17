---
name: referral-frontend
description: Extend or repair ReferralReady's minimal Nuxt frontend, patient-information graph, PDF attachment UI, or result checklist. Use for work in this repository's three-panel screen.
---

# Referral frontend

Read root `AGENTS.md` for the current scope. The accepted direction is three visible sections: one applicant PDF, information nodes, checklist. The user also authorized a simple applicant dashboard and placeholder summary around this processor. Keep those pages skeletal.

Use `frontend/app/components/DecisionProcessor.vue` for the composition and graph slots, `useReviewWorkspace.ts` for root-provided session state, and `data/demo.ts` for fictional fixtures. Prefer extracting focused Vue components as the screen grows rather than adding service logic to the template.

See `docs/page-handoff.md` for route ownership and the shared session interface.

## Graph invariants

- One applicant has one combined PDF. One identity fact can link to several passages/pages in that PDF; each citation uses an evidence ID. R01 uses summary-only mock nodes and checklist, with no invented patient values or source anchors. Switch applicants separately from PDF preview.
- Different dated measurements may be distinct facts. A different value is not automatically a contradiction.
- Facts can support multiple checklist items. Keep `Fact.rule_ids` and `Rule.fact_ids` consistent.
- A selected fact highlights its incoming document edges and outgoing checklist paths. Recalculate the latter after pan/zoom, drag, resizing, and checklist expansion/scrolling.
- Show small readable batches of facts; preserve the category selector and paging. Do not fit hundreds of nodes into unreadably small cards.

## State and interaction

Use shadcn-vue's source-owned controls in `app/components/ui/` (add more with `npx shadcn-vue@latest add <name>`). Source review is a side panel (`SourceReviewPanel.vue`), not a dialog: it hides the PDF list and shows the continuous viewer beside the checklist. Navigation is node → requirement (scroll + flash in the checklist) → source (panel scrolled to the highlighted line); nodes do not open the PDF directly. Attached PDFs are object URLs and are rendered by `PdfSourceViewer.client.vue`, without automatic uploads, OCR, or text extraction. Explicit Analyze sends one PDF and patient name to the Nuxt Claude endpoint. Retain object URLs while navigating between applicants/pages; revoke on root unmount. Display pending, running, error and completed Claude states honestly.

PDF previews use the bundled PDF.js worker. Use document/page/bbox evidence anchors for highlights, not a text-search guess. Synthetic PDFs are generated from fixtures in `lib/demoPdf.ts` and their authored anchors in `data/demo.ts`. Keep those two coordinated. A null anchor displays a page-only preview. Changing source/page or resizing must keep the overlay aligned and cancel superseded renders.

Review adjustments preserve `original_value` and append session audit notes. Checklist completion and applicability counts derive from visible state. The server supplies a coordinator-facing recommendation; coordinator edits invalidate it and affected rule statuses. No final admission action is automated.

## Verify

Run `npm run typecheck` and `npm run build` in `frontend/`. Inspect the rendered desktop three-column screen and the compact stacked layout when relevant. Exercise the changed path: select a source/fact, open a review, change a value, or attach a PDF. Check that linked checklist values reflect edits. Never use real packet content in committed screenshots or demo fixtures.
