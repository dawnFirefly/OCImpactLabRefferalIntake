# Pages and persisted workspace

`app.vue` creates one root `useReviewWorkspace()` and provides it to the three existing routes. Navigation and refresh restore stored applicants via the opaque `?applicant=stored-<id>` query; the last applicant ID is also remembered in sessionStorage. Patient content and API keys are never placed in that storage.

- `/`: persistent applicant list, intake editing, AI settings, review-status controls.
- `/processor`: one original PDF, forms/facts graph, criteria checklist, source review and per-item adjustments.
- `/summary`: read-only view of the selected applicant's recommendation, gaps, documents and evidence.

Homepage creation and processor uploads persist the original PDF/intake before analysis. `createApplicantForAnalysis` is asynchronous; callers must await it and use the returned applicant ID in navigation. `selectApplicant` is also asynchronous and loads the saved graph.

The `Referral` model contains every document, section, fact, evidence item, rule and canonical relationship. Vue Flow displays a subset; never save only visible canvas nodes/edges. `graphLayout` stores all user-positioned node IDs and the viewport. `shared/workspace.ts` validates the graph, removes transport-only fields and checks bidirectional fact/rule links.

`saveWorkspace` serializes saves per applicant and tracks acknowledged revisions. Fact/rule edits append audit records, preserve original values/rationale and invalidate affected recommendations. Layout changes save on drag/camera completion. Pending or failed saves remain visible and prevent internal navigation until resolved. A failed save leaves local edits in memory, with an explicit retry action.

The server uses conditional R2 writes or atomic disk replacement to save complete snapshots; revisions prevent another tab from silently replacing newer work. Deletion leaves a data-free marker so stale analysis/save requests cannot recreate a review. Legacy analysis JSON loads through the workspace endpoint with revision zero until its first workspace save. Reanalysis after human edits requires a separate applicant, preserving the reviewed record.

`makeAnalysisProvider` captures the selected settings for each job. Workers AI is the default. Keys are session-only and do not enter workspace records. The browser's PDF.js renderer supplies physical-page images to Cloudflare/OpenCode; Anthropic receives the original PDF. Synthetic/provided local examples stay distinct from real persisted applicants.

Run tests, typecheck, regular/Worker builds, and relevant browser flows with fictional packets only. See README for deployment/public-access settings and current provider/background-work limits.
