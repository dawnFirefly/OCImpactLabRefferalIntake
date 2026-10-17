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

### Use the supplied R01 / R02 PDFs locally

```sh
node scripts/link-demo-pdfs.mjs /path/to/referral-packets
cd frontend
npm run dev
```

Pass the containing directory, not an individual PDF. The script creates Git-ignored symlinks, without copying or analyzing PDF contents. The applicant picker switches between R01 and R02, each with one combined PDF. R01 shows nine mock information nodes and a 4/9 document-presence checklist from the supplied inventory; clinical findings remain unverified. Choose **Synthetic flow** to demonstrate information nodes and authored highlights; choose **Provided PDFs** to return to the original packets. The original packets have no extracted patient values or verified highlights until Claude is connected.

These links are local demo assets. Do not publish or distribute a build containing the provided packets; keep the ignored `frontend/public/local-demo/` directory out of shared artifacts.

## What works

- Three-panel workspace with synthetic, clearly labeled example data.
- One combined PDF per applicant, linked to information nodes and checklist items. Repeated information can cite multiple pages of the same packet.
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

## Three-page scaffold

- `/`: referral intake dashboard: summary counts, search, status/priority filters, sorting, inline review status (New, In review, Needs info, Approved, Denied, Completed — set manually by the coordinator), and a 2-hour review countdown from the received time. **Add applicant** uploads one combined referral PDF, which the server stores (see below). Opening a *New* referral marks it *In review*.
- `/processor`: the existing PDF → information nodes → checklist workspace.
- `/summary`: placeholder summary, items needing attention, and recommended changes.

Use **Continue to summary** to demonstrate the flow. There is no automatic analysis completion or summary generation yet. Uploaded applicants and their PDFs persist on the server. Review edits remain in memory across route navigation and reset on reload. Page ownership and shared contracts are documented in [the page handoff](docs/page-handoff.md).

## Packet storage

**Add applicant** opens a dialog that posts a name, optional intake details (received time, priority, referring facility, referrer contact, assigned reviewer, notes), and one PDF (max 50 MB, checked for a `%PDF-` header) to Nuxt server routes in `frontend/server/`:

| Route | Purpose |
| --- | --- |
| `GET /api/applicants` | List stored applicants |
| `POST /api/applicants` | Multipart `name` + `file`; stores the PDF |
| `GET /api/applicants/:id/pdf` | Stream the stored PDF to the processor preview |
| `PATCH /api/applicants/:id` | Update intake details or review status (JSON) |
| `DELETE /api/applicants/:id` | Delete (local) or move to Drive trash |

**Default: local disk.** With no configuration, PDFs and an `index.json` go to `frontend/.data/referrals/` (Git-ignored). This needs no setup but only lives on the machine running the server.

**Optional: Google Drive.** Copy `frontend/.env.example` to `frontend/.env` and fill in all four values; the server then stores and lists packets in one Drive folder (applicant metadata is kept in each file's `appProperties`), so everyone using that server sees the same list.

1. In Google Cloud Console, enable the **Google Drive API**, then create an OAuth client ID (type *Web application*) with `https://developers.google.com/oauthplayground` as an authorized redirect URI.
2. In the [OAuth Playground](https://developers.google.com/oauthplayground), open the settings gear, choose **Use your own OAuth credentials**, and enter the client ID and secret. Authorize the scope `https://www.googleapis.com/auth/drive`, then exchange the code for tokens and copy the **refresh token**. If the OAuth consent screen is in *Testing* mode, refresh tokens expire after 7 days; publish it, or regenerate the token when it expires.
3. Create a Drive folder and copy its ID from the URL (`drive.google.com/drive/folders/<FOLDER_ID>`). Shared drives work too.
4. Restart `npm run dev`. Upload responses show `"storage": "google_drive"`.

Referral packets contain patient information. Use a Drive account and folder your organization has approved for that data, keep sharing restricted, and never commit `.env`. There is no authentication on these routes: run the server only on a trusted machine or network.
