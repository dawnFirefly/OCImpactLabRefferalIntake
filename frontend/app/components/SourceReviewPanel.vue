<script setup lang="ts">
import { X, FileText, ChevronDown, ChevronUp } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Evidence, Fact, Rule } from "../types";

/** What the coordinator opened: a fact or checklist card to review, or a source/form to read. */
export type ReviewTarget =
  | { kind: "fact"; id: string }
  /** `factId`: the fact the coordinator came from; its quote is shown first. */
  | { kind: "rule"; id: string; factId?: string }
  | { kind: "section"; id: string }
  | { kind: "document"; id: string };

const props = defineProps<{ target: ReviewTarget }>();
const emit = defineEmits<{ close: []; select: [target: ReviewTarget] }>();
const { referral, updateFact, updateRule } = inject<ReturnType<typeof useReviewWorkspace>>("review-workspace")!;

const isPacketMock = computed(() => referral.value.status === "mock_review");
const fact = computed<Fact | undefined>(() => props.target.kind === "fact" ? referral.value.facts.find((f) => f.id === props.target.id) : undefined);
const rule = computed<Rule | undefined>(() => props.target.kind === "rule" ? referral.value.checklist.rules.find((r) => r.id === props.target.id) : undefined);
const section = computed(() => props.target.kind === "section" ? referral.value.sections?.find((s) => s.id === props.target.id) : undefined);
const title = computed(() => fact.value?.label || rule.value?.text || section.value?.title || referral.value.documents.find((d) => d.id === props.target.id)?.name || "Source");
const kindLabel = computed(() => ({ fact: "Patient fact", rule: rule.value?.id ? `Requirement · ${rule.value.id}` : "Requirement", section: "Form / section", document: "Applicant PDF" })[props.target.kind]);

const evidence = computed<Evidence[]>(() => {
  const ids = fact.value ? fact.value.evidence_ids
    : rule.value ? rule.value.fact_ids.flatMap((id) => referral.value.facts.find((f) => f.id === id)?.evidence_ids || []) : [];
  return [...new Set(ids)].map((id) => referral.value.evidence.find((e) => e.id === id)).filter(Boolean)
    .sort((a, b) => a!.page - b!.page) as Evidence[];
});
const linkedFacts = computed(() => rule.value ? rule.value.fact_ids.map((id) => referral.value.facts.find((f) => f.id === id)).filter(Boolean) as Fact[] : []);
const focusedEvidence = ref<string | null>(null);
const focusTick = ref(0);
/** Default citation: the originating fact's located quote, then any located quote, then the first. */
const preferredEvidence = computed(() => {
  const fromFact = props.target.kind === "rule" && props.target.factId
    ? referral.value.facts.find((f) => f.id === (props.target as { factId?: string }).factId)?.evidence_ids || [] : [];
  const ranked = [...evidence.value].sort((a, b) =>
    Number(fromFact.includes(b.id)) - Number(fromFact.includes(a.id)) || Number(!!b.bbox) - Number(!!a.bbox));
  return ranked[0];
});
const currentEvidence = computed(() => evidence.value.find((e) => e.id === focusedEvidence.value) || preferredEvidence.value);
const pdfDocument = computed(() =>
  referral.value.documents.find((d) => d.id === (currentEvidence.value?.document_id || section.value?.document_id || props.target.id)) || referral.value.documents[0]);
const citedPages = computed(() => [...new Set(section.value ? section.value.pages : evidence.value.map((e) => e.page))]);
const focusPage = ref(1);
function focus(e: Evidence) {
  focusedEvidence.value = e.id;
  focusPage.value = e.page;
  focusTick.value++;
}
function focusPageNumber(page: number) {
  focusPage.value = page;
  focusTick.value++;
}

const editValue = ref(""), editNote = ref(""), reviewStatus = ref("unknown"), reviewError = ref(""), saved = ref("");
const adjusting = ref(false);
watch(() => [props.target.kind, props.target.id, props.target.kind === "rule" ? props.target.factId : ""], () => {
  editValue.value = fact.value?.value || "";
  editNote.value = fact.value?.review_note || rule.value?.note || "";
  reviewStatus.value = rule.value?.status || "unknown";
  reviewError.value = saved.value = "";
  focusedEvidence.value = preferredEvidence.value?.id || null;
  focusPage.value = currentEvidence.value?.page || citedPages.value[0] || 1;
  focusTick.value++;
}, { immediate: true });

function save(status = "confirmed") {
  if (editNote.value.trim().length < 3) return void (reviewError.value = "Add a short note explaining the adjustment.");
  if (fact.value) {
    if (!editValue.value.trim()) return void (reviewError.value = "Enter a value.");
    updateFact(fact.value, editValue.value.trim(), editNote.value, status);
  } else if (rule.value) updateRule(rule.value, reviewStatus.value, editNote.value);
  reviewError.value = "";
  saved.value = "Saved for this session. Linked requirements were flagged for recheck.";
}
const statusOptions: [string, string][] = [
  ["met", "Completed"], ["uncertain", "Uncertain"], ["missing", "Missing evidence"], ["not_met", "Requirement not met"],
  ["concern", "Needs clarification"], ["not_applicable", "Not applicable"], ["unknown", "Unknown"],
];
const sourceNote = computed(() => isPacketMock.value
  ? "Mock review from the supplied packet summary. No page citations were extracted; scroll the packet to verify."
  : referral.value.status === "analyzing" ? "Provisional · Claude is still writing. Adjust after the validated result arrives."
  : referral.value.status === "analyzed" ? "Claude-reported pages and quotes. Verify against the PDF. Original values are kept when you edit."
  : referral.value.status === "demo" ? "Synthetic PDF with authored example anchors." : "Browser-only preview. Analyze with Claude to link facts to pages.");
</script>

<template>
  <section class="panel review-panel" aria-labelledby="review-title">
    <header class="panel-head review-head">
      <div class="head-row">
        <div class="eyebrow">{{ kindLabel }}</div>
        <Button variant="ghost" size="icon" class="size-7" aria-label="Close source review" @click="emit('close')"><X :size="15" /></Button>
      </div>
      <h2 id="review-title" class="review-title">{{ title }}</h2>
      <div class="review-badges">
        <Badge v-if="fact" variant="secondary">{{ fact.value || (fact.status === 'redacted' ? 'Redacted' : 'Missing') }}{{ fact.unit ? ` ${fact.unit}` : '' }}</Badge>
        <Badge v-if="fact || rule" variant="outline">{{ (fact || rule)!.status.replace('_', ' ') }}</Badge>
        <Badge v-if="section" variant="outline">{{ section.pages.length ? `Pages ${section.pages.join(', ')}` : 'Not found in PDF' }}</Badge>
        <Badge v-if="isPacketMock" variant="outline">Mock review</Badge>
      </div>
    </header>

    <div v-if="evidence.length || linkedFacts.length || (section && section.pages.length)" class="citations" aria-label="Linked sources">
      <button v-for="e in evidence" :key="e.id" class="citation" :class="{ active: currentEvidence?.id === e.id }" @click="focus(e)">
        <span class="citation-page mono">p.{{ e.page }}</span><span class="citation-quote">{{ e.quote }}</span>
      </button>
      <template v-if="section">
        <button v-for="p in section.pages" :key="p" class="citation" :class="{ active: focusPage === p }" @click="focusPageNumber(p)">
          <span class="citation-page mono">p.{{ p }}</span><span class="citation-quote">{{ section.title }}</span>
        </button>
      </template>
      <div v-if="linkedFacts.length" class="linked-facts">
        <span class="tiny muted">Linked facts</span>
        <button v-for="f in linkedFacts" :key="f.id" class="linked-fact" @click="emit('select', { kind: 'fact', id: f.id })">
          {{ f.label }} · {{ f.value || f.status }}
        </button>
      </div>
    </div>
    <p v-else-if="fact || rule" class="empty-evidence review-empty">
      {{ isPacketMock ? "No verified page for this mock item. Scroll the packet to review it." : "No readable supporting evidence is linked to this item." }}
    </p>

    <div class="review-viewer">
      <ClientOnly>
        <PdfSourceViewer
          v-if="pdfDocument?.local_url"
          :url="pdfDocument.local_url"
          :title="pdfDocument.name"
          :page="focusPage"
          :focus-key="focusTick"
          :bbox="currentEvidence && currentEvidence.page === focusPage ? currentEvidence.bbox : null"
          :cited-pages="citedPages"
          :box-note="currentEvidence?.method === 'claude' ? 'Highlight position is approximate (located by Claude) · verify against the page.' : ''"
        />
        <div v-else class="empty-evidence"><FileText :size="18" /> No PDF attached to this applicant.</div>
      </ClientOnly>
    </div>

    <template v-if="(fact || rule) && referral.status !== 'analyzing'">
      <Separator />
      <button class="adjust-toggle" :aria-expanded="adjusting" aria-controls="review-form" @click="adjusting = !adjusting">
        <span>Review / adjust{{ saved && !adjusting ? " · saved" : "" }}</span>
        <ChevronUp v-if="!adjusting" :size="14" /><ChevronDown v-else :size="14" />
      </button>
      <form v-show="adjusting" id="review-form" class="review-form" @submit.prevent="save()">
        <p v-if="rule?.note && referral.status === 'analyzed'" class="tiny muted rule-note">{{ rule.note }}</p>
        <div v-if="fact" class="review-field">
          <label for="fact-value">Value</label>
          <Textarea id="fact-value" v-model="editValue" rows="2" />
          <p v-if="fact.value !== fact.original_value" class="correction">Original: {{ fact.original_value }}</p>
        </div>
        <div v-if="rule" class="review-field">
          <label for="rule-status">Checklist status</label>
          <Select v-model="reviewStatus">
            <SelectTrigger id="rule-status" class="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="[value, label] in statusOptions" :key="value" :value="value">{{ label }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div class="review-field">
          <label for="review-note">Adjustment note</label>
          <Textarea id="review-note" v-model="editNote" rows="2" placeholder="Why is this adjustment needed?" />
        </div>
        <p v-if="reviewError" class="error-box" role="alert">{{ reviewError }}</p>
        <p v-else-if="saved" class="tiny saved-note" role="status">{{ saved }}</p>
        <div class="dialog-actions">
          <Button type="submit" size="sm">Save adjustment</Button>
          <Button v-if="fact" type="button" size="sm" variant="outline" @click="save('questioned')">Flag for clarification</Button>
        </div>
      </form>
    </template>
    <footer class="panel-foot"><span>{{ sourceNote }}</span></footer>
  </section>
</template>

<style scoped>
.review-head { padding: 16px 18px 14px; }
.review-title { font-size: 15px; font-weight: 600; line-height: 1.4; margin-top: 4px; }
.review-badges { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.citations { display: grid; gap: 4px; padding: 10px 14px; max-height: 150px; overflow: auto; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.citation { display: flex; gap: 10px; text-align: left; padding: 6px 8px; border-radius: 6px; font-size: 11px; line-height: 1.5; border: 1px solid transparent; }
.citation:hover { background: #f5f7f1; }
.citation.active { background: #fffbec; border-color: #d8c27f; }
.citation-page { flex-shrink: 0; font-weight: 600; color: #8a6a1f; width: 34px; }
.citation-quote { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.linked-facts { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding-top: 6px; }
.linked-fact { font-size: 10px; padding: 3px 8px; border: 1px solid var(--border); border-radius: 999px; }
.linked-fact:hover { border-color: #8caa7a; }
.review-empty { margin: 10px 14px 0; padding: 12px; }
.review-viewer { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 10px 14px; }
.review-viewer :deep(.pdf-viewer) { flex: 1; min-height: 0; }
.review-viewer :deep(.pdf-scroll) { min-height: 160px; }
.adjust-toggle { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; font-size: 12px; font-weight: 600; flex-shrink: 0; }
.adjust-toggle:hover { background: #f5f7f1; }
.review-form { padding: 0 16px 12px; flex-shrink: 0; overflow: auto; max-height: 45%; }
.review-form .review-field { margin: 10px 0; }
.review-form :deep(textarea) { min-height: 44px; }
.rule-note { margin-top: 10px; line-height: 1.6; }
.saved-note { color: #4e7855; }
</style>
