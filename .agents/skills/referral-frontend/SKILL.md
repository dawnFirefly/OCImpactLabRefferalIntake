---
name: referral-frontend
description: Extend or repair ReferralReady's minimal Nuxt frontend, patient-information graph, PDF attachment UI, or result checklist. Use for work in this repository's three-panel screen.
---

# Referral frontend

Read root `AGENTS.md` for the current scope. The accepted direction is three visible sections: source PDFs, information nodes, checklist. Avoid expanding it into a complete website.

Use `frontend/app/app.vue` for the composition and graph slots, `useReviewWorkspace.ts` for session state, and `data/demo.ts` for fictional fixtures. Prefer extracting focused Vue components as the screen grows rather than adding service logic to the template.

## Graph invariants

- One matching identity fact can link to several source documents; each source uses an evidence ID.
- Different dated measurements may be distinct facts. A different value is not automatically a contradiction.
- Facts can support multiple checklist items. Keep `Fact.rule_ids` and `Rule.fact_ids` consistent.
- A selected fact highlights its incoming document edges and outgoing checklist paths. Recalculate the latter after pan/zoom, drag, resizing, and checklist expansion/scrolling.
- Show small readable batches of facts; preserve the category selector and paging. Do not fit hundreds of nodes into unreadably small cards.

## State and interaction

Use shadcn-vue's source-owned controls in `app/components/ui/` and the existing ReKa-backed Dialog. Attached PDFs are object URLs and are rendered by `PdfSourceViewer.client.vue`, without uploads, OCR, or text extraction. Revoke object URLs on reset/unmount. Display the pending Claude state honestly.

PDF previews use the bundled PDF.js worker. Use document/page/bbox evidence anchors for highlights, not a text-search guess. Synthetic PDFs are generated from fixtures in `lib/demoPdf.ts` and their authored anchors in `data/demo.ts`. Keep those two coordinated. A null anchor displays a page-only preview. Changing source/page or resizing must keep the overlay aligned and cancel superseded renders.

Review adjustments preserve `original_value` and append session audit notes. Checklist completion and applicability counts derive from visible state. No admission outcome is inferred by the frontend.

## Verify

Run `npm run typecheck` and `npm run build` in `frontend/`. Inspect the rendered desktop three-column screen and the compact stacked layout when relevant. Exercise the changed path: select a source/fact, open a review, change a value, or attach a PDF. Check that linked checklist values reflect edits. Never use real packet content in committed screenshots or demo fixtures.
