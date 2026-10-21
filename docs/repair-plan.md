# Referral Intake repair plan

Status: implemented on the repair branch; production deployment and live provider inference remain unverified.

Implemented: persistent uploads/full graph snapshots, item-scoped edits and graph layout restoration, revision conflicts/deletion markers, protected API routes, Workers AI default and vision pipeline, optional Anthropic/OpenCode settings and user keys, branding and updated setup docs. Local tests, browser verification, builds and Worker dry-run are recorded in the PR. GitHub rejected repository name/description changes with HTTP 403 (integration administration permission unavailable); the app/package/README branding is updated, and the requested repository metadata remains pending. Original checklist below is retained as planning context, not a claim that every stretch item (durable jobs, Drive parity or automatic reanalysis reconciliation) shipped. Reanalysis after human edits is blocked instead of overwriting them.

## Accepted requirements

- Display name: **Referral Intake**. Proposed GitHub repository slug: `referral-intake`.
- Description: "A one-day hackathon prototype for reviewing hospital referral PDFs against recuperative-care admission criteria, with source-linked AI suggestions and coordinator review."
- **Cloudflare Workers AI is the default analysis provider.** Anthropic and OpenCode are optional providers. Confirm the particular OpenCode service/API format before implementing that adapter; a generic OpenAI-compatible endpoint is not sufficient evidence of PDF support.
- Provide AI settings on the homepage for provider/model selection and a user-supplied API key. Cloudflare's deployed AI binding should work without asking the app user for a key.
- **Persistence includes the complete `/processor` workspace for each applicant**, not just homepage metadata or the original PDF. Store every node and relationship, including nodes outside the current graph page/filter, and restore notes to the exact patient and item.
- Keep coordinator decisions distinct from AI recommendations, original evidence distinct from corrections, and one original combined PDF per applicant.

## 1. Cloudflare MCP setup

The project includes `.codex/config.toml` with the official Streamable HTTP endpoints:

- Account API: `https://mcp.cloudflare.com/mcp` (OAuth required).
- Documentation: `https://docs.mcp.cloudflare.com/mcp`.

In a writable Codex installation, register and authorize the account connection:

```sh
codex mcp add cloudflare-api --url https://mcp.cloudflare.com/mcp
codex mcp login cloudflare-api
codex mcp add cloudflare-docs --url https://docs.mcp.cloudflare.com/mcp
codex mcp list
```

If the trusted project's configuration already registers these names, use `codex mcp login cloudflare-api` and verify with `codex mcp list` instead of registering duplicates. Restart/reopen the Codex session when necessary to load project MCP configuration. Do not commit OAuth credentials or API tokens.

Verified in this planning session: the documentation server successfully initialized, listed tools, and answered Workers AI documentation searches. Global registration was attempted but failed because the managed environment's Codex configuration directory is mounted read-only. Project configuration does not establish account authorization; account reads, binding changes, and deployments remain unverified.

After OAuth, inspect the existing `ocimpactlabrefferalintake` Worker, R2 bindings, AI binding, access policy, and runtime limits through the API MCP. Keep the current Worker URL while changing the app/repository branding; a Worker rename is a separate migration.

References: [Cloudflare MCP servers](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/), [Workers AI bindings](https://developers.cloudflare.com/workers-ai/configuration/bindings/).

## 2. Persist the full processor workspace (P0)

### Findings

- `ApplicantIntakeDialog.vue` calls `createApplicantForAnalysis`, which creates only a session record. The storage endpoint exists but is not used for this flow.
- `updateFact` and `updateRule` mutate browser state and append session audit entries; no endpoint saves those edits.
- Graph nodes/edges are computed from currently visible facts and sections. Node positions are generated again, and fact-to-requirement wires are drawn from references. Saving only the current Vue Flow canvas would omit hidden nodes and relationships.
- The active applicant is not encoded in the processor/summary URL; direct visits start with the demo.

### Storage model

Keep exact PDF bytes in private R2. Store a versioned workspace JSON per applicant alongside existing analysis objects, with a local-disk equivalent for development. Extend the current storage abstraction rather than adding a second unrelated applicant store.

| Persisted field | Contents |
| --- | --- |
| Identity/version | Schema version, applicant ID, revision, updated timestamp, analysis revision/provider/model |
| Complete domain nodes | All PDF records, sections/forms, patient facts, and checklist requirements; stable IDs independent of visible pages |
| Complete relationships | PDF-to-section, section-to-fact, citation-to-fact, and fact-to-requirement links; preserve all supporting evidence references |
| Evidence | Original page, quote, source document ID, optional approximate bounding box, and provenance |
| Review edits | Corrected values, original values, item-specific notes/status, and audit entries scoped to applicant and item |
| Graph layout | User-positioned nodes keyed by stable node ID; viewport and useful panel/filter state |
| Intake | Patient/reference name, general intake notes, source, reviewer, received time, priority, coordinator status |

Store semantic relationships explicitly or through a single canonical set of validated references from which edges are reconstructed deterministically. Avoid competing edge and reference copies that can disagree. Rendering wires must use the persisted relationships; never persist SVG pixel paths as clinical relationships. Never persist `blob:` URLs, transient streaming previews, API keys, or temporary selection highlights.

### Implementation checklist

- [ ] Route homepage creation through persistent applicant storage before analysis.
- [ ] Persist applicants uploaded directly in `/processor` as well, with an explicit saving state and recoverable failures.
- [ ] Add versioned workspace read/write endpoints scoped to the applicant ID; validate schema, IDs, evidence references, and finite layout coordinates.
- [ ] Store the complete domain graph, not the current paginated Vue Flow subset.
- [ ] Capture node drag completion and meaningful layout/view changes per applicant; load positions before framing the graph.
- [ ] Save fact/rule adjustments against the exact applicant ID and item ID captured when editing began. Reset drafts on applicant/item changes.
- [ ] Debounce layout saves; acknowledge note/correction saves only after storage confirms them. Flush pending work on internal navigation and warn about unsaved changes where needed; do not rely on tab-close requests for correctness.
- [ ] Use conditional writes/revisions to reject stale changes from another tab. Fix the first R2 index write's missing existence precondition and serialize/atomically replace local indexes.
- [ ] Add applicant IDs to processor/summary links and load the correct stored workspace on refresh/direct navigation.
- [ ] Make reanalysis create a new analysis revision; preserve coordinator edits and flag items that need reconciliation instead of silently overwriting them.
- [ ] Migrate legacy stored analyses on read, deriving initial nodes/links and default positions. Treat ephemeral sessions as unsaved until their PDF/workspace are uploaded.
- [ ] Fix false save confirmation: the analysis callback currently ignores `saveAnalysis(...) === false`.
- [ ] Define Google Drive workspace persistence or explicitly restrict persistent review mode to supported stores; Drive currently cannot save analyses.

### Acceptance checks

Create applicants A and B using fictional PDFs. Give the same rule ID different notes on each. Correct a fact, drag nodes on multiple graph pages, and save. Switch patients, navigate to summary and back, refresh, and reopen each applicant by URL. All nodes, links, notes, original/corrected values, and positions must match the saved patient. Verify hidden nodes and their links survive. Repeat with a failed save, concurrent tabs, deletion during analysis, and reanalysis after human review.

## 3. Workers AI default and optional keys (P1)

- [ ] Add the `AI` binding to both Wrangler and Nitro deployment configuration; use `event.context.cloudflare.env.AI` on the server.
- [ ] Introduce a provider abstraction for document extraction and criteria evaluation, reusing existing Zod/cross-reference validation and deterministic decision rules.
- [ ] Select Workers AI by default. Never silently send a packet to Anthropic or another paid provider when Cloudflare fails.
- [ ] Validate a Cloudflare-hosted scanned-PDF extraction path before claiming full compatibility. `AI.toMarkdown` PDF support alone does not demonstrate accurate extraction from faxed/image-only PDFs or trustworthy physical-page citations. Preserve page provenance; return no bounding box when location is unavailable.
- [ ] Verify model availability, structured JSON support, input/output limits, packet/page limits, and processing budgets against official docs and the authorized account. Use fictional scanned documents for live checks.
- [ ] Set explicit limits and actionable errors for unsupported scans/large packets. Do not label inaccessible or unprocessed evidence as a proven absence.
- [ ] Retain the original PDF and existing two-stage evidence/rule semantics. No local OCR dependency is planned.
- [ ] Add homepage provider/model/key settings, masked inputs, test-connection and clear controls. Keep keys session-only by default; send only to the same-origin backend over HTTPS, never into workspace records or public Nuxt config.
- [ ] Retain deployment secrets as optional defaults and document which credentials each provider requires. MCP account access and app inference credentials are separate concerns.
- [ ] Record provider/model on saved analyses and use provider-neutral UI labels.
- [ ] Exercise authentication errors, limits, malformed output, interrupted streams, retries, and cancellation for each adapter.

References: [Markdown conversion](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/), [conversion binding](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/usage/binding/), [JSON mode](https://developers.cloudflare.com/workers-ai/features/json-mode/).

## 4. Access and reliability (P0/P1)

- [ ] Apply a consistent authorization boundary to all applicant/workspace/PDF endpoints. Several current CRUD/read endpoints lack the analysis endpoint's access check.
- [ ] Preserve ordinary same-origin GET/PDF range loading when centralizing checks: browser GET requests may omit `Origin`; do not copy the current mutation-only origin requirement unchanged.
- [ ] Make public demo mode explicit; verify account policy and server checks agree before enabling persistent patient data.
- [ ] Refresh existing dashboard entries, not just append previously unknown applicants.
- [ ] Make analysis queue/concurrency behavior explicit across Worker instances. Persist background jobs if completion after closing a tab is required; a browser queue cannot guarantee that.
- [ ] Prevent stale analysis or save responses from replacing another applicant or resurrecting a deleted record.
- [ ] Verify PDF signatures/sizes, invalid dates, consistent storage limits, retry states, and desktop/mobile review interactions.

## 5. Branding and documentation (P2)

- [ ] Rename the GitHub repository to `referral-intake` and update its description to the accepted wording after implementation references are prepared.
- [ ] Use **Referral Intake** in navigation, package metadata, browser titles, README, and page descriptions; credit the one-day hackathon and original team.
- [ ] Update setup, provider/key, storage, persistence, and deployment documentation to match the final behavior. Existing handoff docs contain obsolete session/storage and API-limit descriptions.
- [ ] Retain the existing deployed Worker hostname unless separately migrating its URL and allowed origins.

## Delivery order and validation

1. Finish account MCP OAuth and inspect existing resources; implement persistence and access fixes.
2. Configure and verify Workers AI as the default; implement optional providers and homepage settings.
3. Validate navigation, reanalysis, concurrency, failure recovery, and responsive UI.
4. Update branding/docs, run `npm test`, `npm run typecheck`, `npm run build`, and a Worker build/dry run, then prepare a reviewable PR with known limits. Deployment is a separate final action after the concrete change is reviewable.

Use fictional packets throughout automated/browser checks. A successful build is not evidence of live provider compatibility or clinical accuracy.

Baseline verification in this workspace: dependency installation, `npm test`, `npm run typecheck`, and `npm run build` completed successfully before application implementation. These checks do not cover the persistence defects identified above; add the acceptance flows when implementing them.
