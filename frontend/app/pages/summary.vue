<script setup lang="ts">
import { AlertTriangle, ArrowLeft, Check, ChevronDown, ChevronLeft, ChevronRight, Clock, FileText, Minus, X } from "@lucide/vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Evidence, ReviewStatus, Rule } from "~/types";
import { evaluateTree, outcomeLabels, ruleStep, type StepOutcome, type TreeStep } from "#shared/decision-tree";
import { REVIEW_WINDOW_MS } from "~/composables/useReviewWorkspace";

/**
 * Referral summary: the decision model's recommendation, required documents, the staged
 * criteria and gaps, beside the source PDF. Read-only; the coordinator decides.
 */
const { referral } = inject<ReturnType<typeof useReviewWorkspace>>("review-workspace")!;
useHead({ title: "Summary · ReferralReady" });

type Tone = "ok" | "bad" | "warn" | "idle";
const rules = computed(() => referral.value.checklist.rules);
const ruleById = computed(() => new Map(rules.value.map((r) => [r.id, r])));
const factById = computed(() => new Map(referral.value.facts.map((f) => [f.id, f])));
const evidenceById = computed(() => new Map(referral.value.evidence.map((e) => [e.id, e])));
const pdf = computed(() => referral.value.documents[0]);
const reviewed = computed(() => rules.value.some((r) => !["not_reviewed", "pending"].includes(r.status)));
const treeView = computed(() => rules.value.length > 0 && rules.value.every((r) => ruleStep.has(r.id)));
const tree = computed(() => evaluateTree(rules.value));

// ── Review clock (dashboard intake) ─────────────────────────────────────────
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => (timer = setInterval(() => (now.value = Date.now()), 30_000)));
onBeforeUnmount(() => clearInterval(timer));
const STATUS_LABEL: Record<ReviewStatus, string> = { new: "Open", in_review: "In review", needs_info: "Needs info", approved: "Approved", denied: "Denied" };
const clock = computed(() => {
  const intake = referral.value.intake;
  if (!intake || ["approved", "denied"].includes(intake.reviewStatus)) return null;
  const ms = new Date(intake.receivedAt).getTime() + REVIEW_WINDOW_MS - now.value;
  const abs = Math.abs(ms), h = Math.floor(abs / 3_600_000), m = Math.floor((abs % 3_600_000) / 60_000);
  const span = h ? `${h}h ${m}m` : `${m}m`;
  return ms < 0 ? { label: `Overdue ${span}`, tone: "bad" as Tone } : { label: `${span} left`, tone: (ms < 30 * 60_000 ? "warn" : "idle") as Tone };
});

// ── Recommendation banner: the decision model's output wins ─────────────────
const decision = computed(() => {
  const rec = referral.value.recommendation;
  if (rec) {
    const label = rec.outcome ? outcomeLabels[rec.outcome]
      : { recommend_approval: "Approved", recommend_denial: "Denied", needs_information: "More information needed" }[rec.status];
    const tone: Tone = rec.status === "recommend_approval" ? "ok" : rec.status === "recommend_denial" ? "bad" : "warn";
    return { label, stage: rec.stage ?? null, reasons: rec.reasons, tone, source: "Claude recommendation from the staged IHH decision tree" };
  }
  if (!treeView.value || !reviewed.value) return null;
  const t = tree.value;
  const tone: Tone = t.outcome === "approved" ? "ok" : t.outcome === "denied" ? "bad" : "warn";
  return { label: outcomeLabels[t.outcome], stage: t.stage?.number ?? null, tone, source: "Staged IHH decision tree over the current checklist",
    reasons: t.rule_ids.map((id) => `${id}: ${ruleById.value.get(id)?.note || "Review this criterion."}`) };
});
const stageTitle = (n: number | null) => tree.value.stages.find((s) => s.stage.number === n)?.stage.title || "";
/** Reasons arrive as "RULE-ID: note"; split so the ID can link to its evidence. */
function splitReason(reason: string) {
  const match = reason.match(/^([A-Z]+-[A-Z]?\d+):\s*([\s\S]*)$/);
  return match && ruleById.value.has(match[1]!) ? { id: match[1]!, text: match[2]! } : { id: "", text: reason };
}

// ── Status helpers ──────────────────────────────────────────────────────────
const RULE_STATUS: Record<string, { label: string; tone: Tone }> = {
  met: { label: "Met", tone: "ok" }, not_met: { label: "Not met", tone: "bad" }, missing: { label: "Missing", tone: "bad" },
  uncertain: { label: "Uncertain", tone: "warn" }, concern: { label: "Needs clarification", tone: "warn" }, unknown: { label: "Unknown", tone: "warn" },
  not_applicable: { label: "N/A", tone: "idle" }, not_reviewed: { label: "Not reviewed", tone: "idle" }, pending: { label: "Pending", tone: "idle" },
};
const ruleStatus = (r?: Rule) => RULE_STATUS[r?.status || "not_reviewed"] || { label: r?.status || "", tone: "idle" as Tone };
const STEP_TONE: Record<StepOutcome, Tone> = { pass: "ok", fail: "bad", unresolved: "warn", not_reviewed: "idle", info: "idle", manual: "idle" };
function stepLabel(step: TreeStep, outcome: StepOutcome) {
  return ({ pass: "Met", fail: step.failLabel || "Not met", unresolved: "Needs review", not_reviewed: "Not reviewed", info: "", manual: "Coordinator check" })[outcome];
}

// ── Evidence lookup ─────────────────────────────────────────────────────────
function evidenceFor(ruleIds: string[]): Evidence[] {
  const ids = new Set(ruleIds.flatMap((id) => (ruleById.value.get(id)?.fact_ids || []).flatMap((f) => factById.value.get(f)?.evidence_ids || [])));
  return [...ids].map((id) => evidenceById.value.get(id)).filter((e): e is Evidence => !!e)
    // Keep the model's citation order (most relevant first); located quotes before unlocated ones.
    .sort((a, b) => Number(!!b.bbox) - Number(!!a.bbox));
}
const firstPage = (ev: Evidence[]) => ev[0]?.page ?? null;

// ── Required documents (DOC-1 … DOC-10) ─────────────────────────────────────
// Only the referral checklist (decision-tree step 6.1); clinical documents (6.2) are listed with the criteria.
const documents = computed(() => rules.value.filter((r) => /^DOC-\d+$/.test(r.id)).map((r) => {
  const ev = evidenceFor([r.id]);
  return { rule: r, ...ruleStatus(r), page: firstPage(ev) };
}));
const sections = computed(() => [...(referral.value.sections || [])].sort((a, b) => (a.pages[0] ?? 999) - (b.pages[0] ?? 999)));

// ── Criteria: decision-tree stages (or rule sections for demo/mock data) ────
/** `ruleIds`: what a click shows in the PDF (failing/open first); `allIds`: every criterion in the row. */
type Row = { key: string; title: string; question: string; finding: string; tone: Tone; badge: string; ruleIds: string[]; allIds: string[]; page: number | null };
type Group = { key: string; number?: number; title: string; badge: string; tone: Tone; rows: Row[] };
const groups = computed<Group[]>(() => {
  if (treeView.value) {
    return tree.value.stages
      .filter((s) => s.stage.number !== 6) // documents have their own card; 6.2 clinical checks are shown below
      .map((s) => ({
        key: s.stage.id, number: s.stage.number, title: s.stage.title,
        badge: outcomeLabels[s.outcome], tone: (s.outcome === "pass" || s.outcome === "approved" ? "ok" : s.outcome === "denied" ? "bad" : s.outcome === "not_reviewed" ? "idle" : "warn") as Tone,
        rows: s.steps.filter((st) => st.step.gate !== "context" && st.step.gate !== "info").map((st) => stepRow(st.step, st.outcome, st.failing, st.open)),
      }))
      .concat(tree.value.stages.filter((s) => s.stage.number === 6).map((s) => {
        const clinical = s.steps.find((st) => st.step.id === "6.2");
        return { key: "clinical", number: 6, title: "Clinical objective verification", badge: clinical ? stepLabel(clinical.step, clinical.outcome) : "",
          tone: clinical ? STEP_TONE[clinical.outcome] : "idle",
          rows: clinical ? clinical.step.rule_ids.map((id) => ruleById.value.get(id)).filter((r): r is Rule => !!r).map(ruleRow) : [] };
      }));
  }
  const bySection = new Map<string, Rule[]>();
  for (const r of rules.value.filter((r) => !documents.value.some((d) => d.rule.id === r.id))) bySection.set(r.section, [...(bySection.get(r.section) || []), r]);
  return [...bySection].map(([section, list]) => ({ key: section, title: section, badge: "", tone: "idle" as Tone, rows: list.map(ruleRow) }));
});
function stepRow(step: TreeStep, outcome: StepOutcome, failing: string[], open: string[]): Row {
  const focus = failing.length ? failing : open.length ? open : step.rule_ids.filter((id) => ruleById.value.get(id)?.status === "met");
  const notes = focus.map((id) => ruleById.value.get(id)?.note).filter((n): n is string => !!n?.trim());
  const ids = focus.length ? focus : step.rule_ids;
  return { key: step.id, title: `${step.id} · ${step.title}`, question: step.question, tone: STEP_TONE[outcome], badge: stepLabel(step, outcome),
    finding: notes[0] ? notes[0] + (notes.length > 1 ? ` (+${notes.length - 1} more)` : "") : "", ruleIds: ids, allIds: step.rule_ids, page: firstPage(evidenceFor(ids)) };
}
function ruleRow(r: Rule): Row {
  const s = ruleStatus(r);
  return { key: r.id, title: r.id, question: r.text, finding: r.note, tone: s.tone, badge: s.label, ruleIds: [r.id], allIds: [r.id], page: firstPage(evidenceFor([r.id])) };
}
const expanded = ref(new Set<string>());
function toggle(key: string) {
  const next = new Set(expanded.value);
  next.has(key) ? next.delete(key) : next.add(key);
  expanded.value = next;
}

// ── Discrepancies and gaps ──────────────────────────────────────────────────
const alerts = computed(() => {
  const items: { key: string; text: string; ruleIds: string[]; factId?: string }[] = [];
  for (const f of referral.value.facts) {
    if (f.status === "conflicting") items.push({ key: `fact-${f.id}`, text: `${f.label}: ${f.discrepancy || f.value || "conflicting information in the packet"}`, ruleIds: f.rule_ids, factId: f.id });
    else if (f.original_value && f.value !== f.original_value) items.push({ key: `edit-${f.id}`, text: `${f.label} corrected by coordinator: “${f.original_value}” → “${f.value}”`, ruleIds: f.rule_ids, factId: f.id });
  }
  for (const d of documents.value.filter((d) => ["missing", "not_met"].includes(d.rule.status))) {
    items.push({ key: `doc-${d.rule.id}`, text: `Missing ${d.rule.id}: ${d.rule.text}`, ruleIds: [d.rule.id] });
  }
  return items;
});

// ── Source viewer selection ─────────────────────────────────────────────────
const selection = ref<{ key: string; label: string; evidence: Evidence[] } | null>(null);
const evidenceIndex = ref(0);
const focusTick = ref(0);
const currentEvidence = computed(() => selection.value?.evidence[evidenceIndex.value]);
const viewerPage = ref<number | null>(null);
function select(key: string, label: string, ruleIds: string[], factId?: string) {
  const fact = factId ? factById.value.get(factId) : undefined;
  const evidence = fact ? fact.evidence_ids.map((id) => evidenceById.value.get(id)).filter((e): e is Evidence => !!e) : evidenceFor(ruleIds);
  selection.value = { key, label, evidence };
  evidenceIndex.value = 0;
  viewerPage.value = evidence[0]?.page ?? null;
  focusTick.value++;
}
function step(delta: number) {
  const list = selection.value?.evidence || [];
  if (!list.length) return;
  evidenceIndex.value = (evidenceIndex.value + delta + list.length) % list.length;
  viewerPage.value = list[evidenceIndex.value]!.page;
  focusTick.value++;
}
function selectPage(key: string, label: string, page: number) {
  selection.value = { key, label, evidence: [] };
  viewerPage.value = page;
  focusTick.value++;
}
const toneClass = (tone: Tone) => `tone-${tone}`;
</script>

<template>
  <main class="summary-page">
    <!-- Left: summary -->
    <section class="summary-left">
      <div class="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <Button as-child variant="ghost" size="sm" class="-ml-2 mb-1 text-muted-foreground">
            <NuxtLink to="/processor"><ArrowLeft class="size-4" />Back to processor</NuxtLink>
          </Button>
          <h1 class="summary-title">{{ referral.title }}</h1>
          <p class="mt-1 text-sm text-muted-foreground">
            {{ pdf?.name || "No PDF attached" }}<template v-if="pdf?.page_count"> · {{ pdf.page_count }} pages</template>
            <template v-if="referral.intake?.source"> · {{ referral.intake.source }}</template>
            <template v-if="referral.intake?.reviewer"> · Reviewer: {{ referral.intake.reviewer }}</template>
          </p>
        </div>
        <div class="flex items-center gap-2">
          <Badge v-if="clock" variant="outline" :class="toneClass(clock.tone)"><Clock />{{ clock.label }}</Badge>
          <Badge v-if="referral.intake" variant="outline">{{ STATUS_LABEL[referral.intake.reviewStatus] }}</Badge>
        </div>
      </div>

      <!-- Not analyzed yet -->
      <Card v-if="!reviewed" class="shadow-none">
        <CardHeader>
          <CardTitle>{{ referral.status === "analyzing" ? "Analysis in progress" : "Not analyzed yet" }}</CardTitle>
          <CardDescription>
            {{ referral.status === "analyzing" ? "The summary fills in once Claude finishes reviewing the packet." : "Run the analysis in the processor to see the recommendation, documents and criteria here." }}
          </CardDescription>
        </CardHeader>
        <CardContent><Button as-child><NuxtLink to="/processor">Open processor</NuxtLink></Button></CardContent>
      </Card>

      <template v-else>
        <!-- Recommendation -->
        <div v-if="decision" class="banner" :class="toneClass(decision.tone)" role="status">
          <div class="flex flex-wrap items-center gap-2">
            <span class="banner-label">{{ decision.label }}</span>
            <span v-if="decision.stage" class="text-sm text-muted-foreground">Stage {{ decision.stage }} · {{ stageTitle(decision.stage) }}</span>
          </div>
          <ul class="mt-3 space-y-1.5 pl-1">
            <li v-for="(reason, i) in decision.reasons" :key="i" class="flex gap-2 text-sm">
              <span class="mt-2 size-1.5 shrink-0 rounded-full bg-current opacity-50" />
              <span>
                <button v-if="splitReason(reason).id" type="button" class="rule-link" @click="select(`reason-${i}`, splitReason(reason).id, [splitReason(reason).id])">{{ splitReason(reason).id }}</button>
                {{ splitReason(reason).text }}
              </span>
            </li>
          </ul>
          <p class="mt-3 text-xs text-muted-foreground">{{ decision.source }} · the coordinator makes the final decision.</p>
        </div>

        <!-- Discrepancies & gaps -->
        <Card v-if="alerts.length" class="alert-card mt-4 gap-2 py-4 shadow-none">
          <CardHeader class="px-4">
            <CardTitle class="flex items-center gap-2 text-sm text-amber-800"><AlertTriangle class="size-4" />Discrepancies & gaps</CardTitle>
          </CardHeader>
          <CardContent class="px-4">
            <ul class="space-y-1">
              <li v-for="a in alerts" :key="a.key">
                <button type="button" class="alert-item" :class="{ on: selection?.key === a.key }" @click="select(a.key, a.text, a.ruleIds, a.factId)">{{ a.text }}</button>
              </li>
            </ul>
          </CardContent>
        </Card>

        <!-- Required documents -->
        <Card v-if="documents.length" class="mt-4 gap-0 py-0 shadow-none">
          <CardHeader class="border-b px-4 py-3">
            <CardTitle class="text-sm">Required documents</CardTitle>
            <CardDescription class="text-xs">{{ documents.filter((d) => d.tone === "ok").length }} of {{ documents.length }} found</CardDescription>
          </CardHeader>
          <CardContent class="flex flex-wrap gap-1.5 p-3">
            <button v-for="d in documents" :key="d.rule.id" type="button" class="doc-chip" :class="[toneClass(d.tone), { on: selection?.key === d.rule.id }]"
              :title="`${d.label}${d.rule.note ? ' · ' + d.rule.note : ''}`" @click="select(d.rule.id, `${d.rule.id} · ${d.rule.text}`, [d.rule.id])">
              <Check v-if="d.tone === 'ok'" class="size-3.5" /><X v-else-if="d.tone === 'bad'" class="size-3.5" /><Minus v-else class="size-3.5" />
              <b class="whitespace-nowrap">{{ d.rule.id }}</b><span class="truncate">{{ d.rule.text }}</span>
            </button>
          </CardContent>
          <details v-if="sections.length" class="border-t px-4 py-2 text-sm">
            <summary class="cursor-pointer text-muted-foreground">Forms found in the packet ({{ sections.length }})</summary>
            <div class="mt-2 grid gap-1 pb-1">
              <button v-for="s in sections" :key="s.id" type="button" class="flex items-center gap-2 text-left hover:underline" :disabled="!s.pages.length"
                @click="selectPage(s.id, s.title, s.pages[0]!)">
                <FileText class="size-3.5 shrink-0 text-muted-foreground" /><span class="flex-1 truncate">{{ s.title }}</span>
                <span class="page-pill">{{ s.pages.length ? `p.${s.pages.join(", ")}` : s.status }}</span>
              </button>
            </div>
          </details>
        </Card>

        <!-- Criteria by decision-tree stage -->
        <Card v-for="g in groups" :key="g.key" class="mt-4 gap-0 py-0 shadow-none">
          <CardHeader class="flex flex-row items-center gap-2 border-b px-4 py-3">
            <span v-if="g.number" class="stage-num">{{ g.number }}</span>
            <CardTitle class="flex-1 text-sm">{{ g.title }}</CardTitle>
            <Badge v-if="g.badge" variant="outline" :class="toneClass(g.tone)">{{ g.badge }}</Badge>
          </CardHeader>
          <CardContent class="p-0">
            <div v-for="row in g.rows" :key="row.key" class="criteria-row" :class="{ on: selection?.key === row.key }">
              <button type="button" class="flex w-full items-start gap-3 px-4 py-2.5 text-left" @click="select(row.key, row.title, row.ruleIds)">
                <span class="dot mt-1.5" :class="toneClass(row.tone)" />
                <span class="min-w-0 flex-1">
                  <span class="flex items-center gap-2"><b class="text-sm">{{ row.title }}</b><span class="status-text" :class="toneClass(row.tone)">{{ row.badge }}</span></span>
                  <span class="block text-xs text-muted-foreground">{{ row.question }}</span>
                  <span v-if="row.finding" class="finding" :class="toneClass(row.tone)">{{ row.finding }}</span>
                </span>
                <span v-if="row.page" class="page-pill">p.{{ row.page }}</span>
              </button>
              <div v-if="row.allIds.length > 1" class="px-4 pb-2 pl-9">
                <button type="button" class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" @click="toggle(row.key)">
                  <ChevronDown v-if="expanded.has(row.key)" class="size-3" /><ChevronRight v-else class="size-3" />{{ expanded.has(row.key) ? "Hide" : "Show" }} {{ row.allIds.length }} criteria
                </button>
                <ul v-if="expanded.has(row.key)" class="mt-1 space-y-1">
                  <li v-for="id in row.allIds" :key="id">
                    <button type="button" class="rule-item" :class="{ on: selection?.key === `${row.key}/${id}` }" @click="select(`${row.key}/${id}`, id, [id])">
                      <span class="font-mono text-[11px]">{{ id }}</span>
                      <span class="status-text" :class="toneClass(ruleStatus(ruleById.get(id)).tone)">{{ ruleStatus(ruleById.get(id)).label }}</span>
                      <span class="block text-muted-foreground">{{ ruleById.get(id)?.text }}</span>
                      <span v-if="ruleById.get(id)?.note" class="block">{{ ruleById.get(id)?.note }}</span>
                    </button>
                  </li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </template>
    </section>

    <!-- Right: source PDF -->
    <section class="summary-right">
      <div class="viewer-bar">
        <template v-if="selection">
          <span class="min-w-0 flex-1 truncate text-sm">
            <b>Source for:</b> {{ selection.label }}
            <span class="text-muted-foreground"> · {{ currentEvidence ? `page ${currentEvidence.page}` : selection.evidence.length ? "" : viewerPage ? `page ${viewerPage}` : 'no linked source' }}</span>
          </span>
          <template v-if="selection.evidence.length > 1">
            <Button variant="ghost" size="icon-sm" aria-label="Previous citation" @click="step(-1)"><ChevronLeft class="size-4" /></Button>
            <span class="text-xs text-muted-foreground tabular-nums">{{ evidenceIndex + 1 }} / {{ selection.evidence.length }}</span>
            <Button variant="ghost" size="icon-sm" aria-label="Next citation" @click="step(1)"><ChevronRight class="size-4" /></Button>
          </template>
          <span v-else-if="!selection.evidence.length && !selection.key.startsWith('section')" class="text-xs text-muted-foreground">No page cited in the packet</span>
        </template>
        <span v-else class="text-sm text-muted-foreground">Select a finding to see its source in the packet.</span>
      </div>
      <div class="viewer-host">
        <ClientOnly>
        <PdfSourceViewer
          v-if="pdf?.local_url"
          :url="pdf.local_url"
          :title="pdf.name"
          :page="viewerPage"
          :focus-key="focusTick"
          :bbox="currentEvidence && currentEvidence.page === viewerPage ? currentEvidence.bbox : null"
          :cited-pages="[...new Set((selection?.evidence || []).map((e) => e.page))]"
          :box-note="currentEvidence?.method === 'claude' ? 'Highlight position is approximate (located by Claude) · verify against the page.' : ''"
        />
        <div v-else class="grid h-full place-items-center text-sm text-muted-foreground">No PDF to show.</div>
        </ClientOnly>
      </div>
    </section>
  </main>
</template>

<style scoped>
.summary-page { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); height: calc(100dvh - 64px); overflow: hidden; }
.summary-left { min-height: 0; overflow-y: auto; padding: 20px 24px 48px; border-right: 1px solid var(--border); }
.summary-right { display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; background: var(--card); }
.summary-title { font-size: 22px; font-weight: 600; letter-spacing: -0.4px; margin: 0; }
.viewer-host { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 10px 14px; }
.viewer-host :deep(.pdf-viewer) { flex: 1; min-height: 0; }
.viewer-bar { display: flex; align-items: center; gap: 8px; min-height: 48px; padding: 6px 16px; border-bottom: 1px solid var(--border); background: var(--background); }
@media (max-width: 960px) {
  .summary-page { grid-template-columns: 1fr; grid-template-rows: auto; height: auto; overflow: visible; }
  .summary-right { height: 85vh; }
}

/* Status tones: green met, red not met/missing, amber needs review, grey not reviewed. */
.tone-ok { --tone: #059669; --tone-bg: #ecfdf5; }
.tone-bad { --tone: #dc2626; --tone-bg: #fef2f2; }
.tone-warn { --tone: #b45309; --tone-bg: #fffbeb; }
.tone-idle { --tone: #788574; --tone-bg: #f1f4ee; }
:deep(.tone-ok), :deep(.tone-bad), :deep(.tone-warn), :deep(.tone-idle) { color: var(--tone); }
.dot { width: 9px; height: 9px; border-radius: 50%; background: var(--tone); flex: none; }

.banner { border: 1px solid var(--border); border-left: 6px solid var(--tone); background: var(--card); border-radius: 12px; padding: 14px 16px; color: var(--foreground); }
.banner-label { display: inline-block; background: var(--tone); color: #fff; font-weight: 700; font-size: 12px; letter-spacing: .04em; text-transform: uppercase; padding: 3px 10px; border-radius: 6px; }
.rule-link { font-family: ui-monospace, monospace; font-size: 12px; font-weight: 600; color: var(--primary); text-decoration: underline; text-underline-offset: 2px; margin-right: 2px; }

.alert-card { border-color: #f59e0b; background: #fffbeb; }
.alert-item { text-align: left; font-size: 13px; width: 100%; padding: 4px 6px; border-radius: 6px; }
.alert-item:hover, .alert-item.on { background: #fef3c7; }

.doc-chip { display: inline-flex; align-items: center; gap: 5px; max-width: 100%; font-size: 12px; padding: 4px 9px; border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--tone) 45%, transparent); background: var(--tone-bg); color: var(--foreground); }
.doc-chip b, .doc-chip svg { color: var(--tone); }
.doc-chip.on { outline: 2px solid var(--tone); }

.stage-num { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 6px; background: var(--muted); font-size: 12px; font-weight: 600; }
.criteria-row { border-bottom: 1px solid var(--border); }
.criteria-row:last-child { border-bottom: 0; }
.criteria-row:hover { background: var(--muted); }
.criteria-row.on { background: #fef9c3; box-shadow: inset 3px 0 var(--primary); }
.status-text { font-size: 11px; font-weight: 600; color: var(--tone); }
.finding { display: block; margin-top: 2px; font-size: 13px; font-weight: 500; color: var(--tone); }
.page-pill { flex: none; font-size: 11px; color: #788574; border: 1px solid var(--border); border-radius: 5px; padding: 1px 6px; white-space: nowrap; }
.rule-item { display: block; width: 100%; text-align: left; font-size: 12px; padding: 4px 8px; border-radius: 6px; }
.rule-item:hover, .rule-item.on { background: var(--background); }
.rule-item .status-text { margin-left: 6px; }
</style>
