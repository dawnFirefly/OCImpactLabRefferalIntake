# Future Claude integration

## Current state

The app is a frontend-only Nuxt 4 / Vue 3 scaffold using shadcn-vue and Vue Flow. It has no Python server, model client, local OCR, document extraction, or network upload. It starts with fictional demo data. Attaching PDFs creates browser object URLs and replaces the demo with an explicit `awaiting_claude` state. Review edits last for the current component/browser session and reset on reload.

## Extension boundary

`frontend/app/services/analysis.ts` exports `AnalysisProvider`:

```ts
analyze(
  files: File[],
  onSnapshot: (snapshot: Referral) => void,
  signal?: AbortSignal,
): Promise<Referral>
```

`pendingClaudeProvider` intentionally throws a clear integration-pending error. It is not invoked by the current attachment UI. The eventual server implementation can use Python, as originally requested, when backend work is explicitly resumed. Keep the Claude API key server-side.

Use `Referral` in `frontend/app/types.ts` as the current screen contract. Version/validate a real transport schema before relying on model responses. Every snapshot contains documents, facts, evidence, checklist rules, and audit state. Stable IDs preserve graph identity across updates.

### Evidence links

- `Fact.evidence_ids` refer to `Evidence.id`.
- `Evidence.document_id` refers to the PDF's `PacketDocument.id`.
- `Evidence.page` is one-based.
- `Evidence.bbox`, when available, is `[left, top, right, bottom]` normalized to the displayed page, including its orientation. A null box means exact highlighting is unavailable.
- `Fact.rule_ids` and `Rule.fact_ids` express the many-to-many fact/checklist relationship.
- `original_value` remains intact when a reviewer changes `value`.

The current source-review dialog shows synthetic excerpts. Real PDF page rendering, exact highlights, processing streams, server persistence, and criteria evaluation are future work. Browser preview of an attached file does not analyze its content.

## Domain sources for the next task

The repo's original `Doc` file links to the team's working notes. The challenge's authoritative materials are in [the organizer's referral-intake folder](https://github.com/travcjohnson/claude-impact-lab-oc/tree/main/challenges/1-referral-intake), including admission criteria, referral-form checklist, and separate historical labels.

The organizer states that internal admission criteria take precedence over the referral form; some conflicts and gaps require human interpretation. Use original rule IDs and confirm criteria applicability. Do not infer eligibility from a diagnosis label alone.

R01 and R02 are separate redacted real referrals. The user supplied historical outcomes of deny and approve respectively, without recorded reasons. These are evaluation labels, not model inputs or rationales. Do not copy the packets into this repository or send their contents to an external service without authorization for that task.

## Suggested next implementation task

After the user asks to resume integration: implement a server-side Claude provider, validate structured output, adapt snapshots into the existing state, and wire the three panels to it. Preserve the frontend's pending/error states, linked evidence, and coordinator adjustment flow. There is no need to rebuild a full website to do that.
