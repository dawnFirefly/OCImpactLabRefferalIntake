# Three-page handoff

The current scope is a navigation skeleton around the working processor. Each page can be built by a separate future agent. This document defines ownership; it does not dispatch agents.

| Future owner | Files | Responsibility |
| --- | --- | --- |
| Dashboard | `frontend/app/pages/index.vue`, `frontend/server/` | Applicant list, PDF upload to server storage, select applicant and open `/processor`. |
| Processor | `frontend/app/pages/processor.vue`, `frontend/app/components/DecisionProcessor.vue` | Existing one-PDF → forms/sections → facts → application requirements review. Preserve preview and review interactions. |
| Summary | `frontend/app/pages/summary.vue` | Replace placeholders when summary requirements and analysis results exist. Do not infer rejection reasons from historical labels. |

Shared files (`app.vue`, `layouts/default.vue`, `composables/useReviewWorkspace.ts`, `types.ts`, shared CSS) require coordination. Prefer page-scoped styles/components for future work.

## Session contract

`app.vue` creates `useReviewWorkspace()` once and provides it as `review-workspace`. Pages/components inject `ReturnType<typeof useReviewWorkspace>`. Do not instantiate independent workspaces per page: that resets selection and edits.

- `applicants`: session-local referral records, including fictional demo, optional local R01–R11 examples, and newly added applicants.
- `referral`: active applicant and current facts/checklist/audit.
- `selectApplicant(id)`: activates an existing record without discarding edits.
- `addApplicant(name)`: adds and selects an empty record with `awaiting_pdf` status. It does not create a backend record.
- `patientName`, `analyzing`, `analyze`, `cancelAnalysis`: explicit server analysis controls; switching applicants cancels browser waiting and prevents stale results from replacing another applicant.
- Existing `attach`, `updateFact`, and `updateRule` mutate session data. One combined PDF per applicant. Upload on a new empty record retains its ID/name.
- Object URLs live for the root session and are revoked on root unmount. An explicit `savePdf` action persists the original PDF to private R2 and sets the document's `storage` receipt. Attachment and preview remain local. `savingPdf` exposes the request state. Records/receipts are session-local; there is no saved-applicant reloading API.
- `loadStoredApplicants()`, `createStoredApplicant(fields, file)`, `updateStoredApplicant(id, fields)`, `deleteStoredApplicant(id)`: server-persisted applicants (`stored-<id>` records with `intake` details; document `local_url` is `/api/applicants/<id>/pdf`). Review status (`new` shown as "Open", `in_review`, `needs_info`, `approved`, `denied`) is set only by a coordinator. `approved`/`denied` record the coordinator's decision; never set them from model output or checklist counts.

The shared navigation links `/`, `/processor`, and `/summary`. Direct links initialize a demo workspace. Route navigation preserves the active applicant. Refresh resets all session changes. The processor uses an explicit **Continue to summary** link. A future analysis agent can navigate to `/summary` after a real completion event; no fake completion timer exists now.

The summary contains headings only. It does not display pass/fail explanations, invented clinical conclusions, or model-generated recommendations. Dashboard creation requires a name/reference and one PDF. Successful creation selects that stored applicant, navigates to `/processor`, and starts Claude analysis once. Editing details or reopening an existing applicant does not start another analysis. Intake details and the applicant reference survive streamed and completed analysis; failures leave the saved applicant available for retry.

## Verification

Run tests, typecheck and build. Exercise dashboard → create/select applicant → processor → summary → back. Check edits remain on the same applicant and R01–R11 stay separate. Never distribute `public/local-demo` packets in a build.
