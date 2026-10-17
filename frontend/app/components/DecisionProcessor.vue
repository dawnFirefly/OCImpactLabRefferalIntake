<script setup lang="ts">
import {
  VueFlow,
  Handle,
  Position,
  useVueFlow,
  type Node,
  type Edge,
} from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import {
  FileText,
  Upload,
  Check,
  Minus,
  ChevronDown,
  ChevronRight,
  Maximize,
  ZoomIn,
  ZoomOut,
  AlertCircle,
  ArrowRight,
} from "@lucide/vue";
import { Button } from "@/components/ui/button";
import type { Fact, Rule, PacketDocument } from "../types";
import type { ReviewTarget } from "./SourceReviewPanel.vue";
import { evaluateTree, outcomeLabels, ruleStep, type TreeStep, type StepOutcome } from "#shared/decision-tree";

const {
  referral,
  analyzing,
  savingPdf,
  savePdf,
  progress,
  analyze,
  cancelAnalysis,
  error,
  resetDemo,
  attach,
  updateFact,
  updateRule,
  mode,
  providedDocuments,
  useProvidedDocument,
} = inject<ReturnType<typeof useReviewWorkspace>>("review-workspace")!;
const selectedDoc = ref<string | null>(null),
  selectedFact = ref<string | null>(null);
const group = ref("All factors"),
  graphPage = ref(0),
  // Context and intake-question steps start folded; everything else is open.
  collapsed = ref(new Set<string>(["step-4.12", "step-6.3"]));
const dragging = ref(false),
  uploadInput = ref<HTMLInputElement | null>(null);
/** Opened fact/card/source. While set, the PDF list hides and the source review panel takes the right side. */
const review = ref<ReviewTarget | null>(null);
const { fitView, zoomIn, zoomOut } = useVueFlow();
const displayedDocuments = computed(() => referral.value.documents);
function switchApplicant(event: Event) {
  const id = (event.target as HTMLSelectElement).value;
  const doc = providedDocuments.value.find((d) => d.id === id);
  if (!doc) return;
  useProvidedDocument(doc);
  selectedDoc.value = null;
  selectedFact.value = null;
  review.value = null;
  group.value = "All factors";
  graphPage.value = 0;
}
const isPacketMock = computed(() => referral.value.status === "mock_review");
function showProvided() {
  graphPage.value = 0;
  if (providedDocuments.value[0]) {
    useProvidedDocument(providedDocuments.value[0]);
    selectedDoc.value = null;
    selectedFact.value = null;
  }
}
/** Claude is streaming provisional nodes into the workspace. */
const live = computed(() => referral.value.status === "analyzing");
const awaitingClaude = computed(
  () => referral.value.status === "awaiting_claude",
);
const confirmedRules = computed(
  () => referral.value.checklist.rules.filter((r) => r.status === "met").length,
);
const applicableRules = computed(
  () =>
    referral.value.checklist.rules.filter((r) => r.status !== "not_applicable")
      .length,
);
const filteredFacts = computed(() =>
  referral.value.facts.filter(
    (f) =>
      (group.value === "All factors" || f.group === group.value) &&
      (!selectedDoc.value || isPacketMock.value ||
        f.evidence_ids.some(
          (id) =>
            referral.value.evidence.find((e) => e.id === id)?.document_id ===
            selectedDoc.value,
        )),
  ),
);
const factPageCount = computed(() =>
  Math.max(1, Math.ceil(filteredFacts.value.length / 5)),
);
const visibleFacts = computed(() =>
  filteredFacts.value.slice(graphPage.value * 5, graphPage.value * 5 + 5),
);
const visibleSections = computed(() => (referral.value.sections || []).filter(s =>
  // While Claude is still listing forms (no facts yet), show every form as it arrives.
  (live.value && !visibleFacts.value.length) ||
  visibleFacts.value.some(f => f.section_ids?.includes(s.id)) || (s.status === "missing" && group.value === "All factors" && graphPage.value === 0)));
// Follow the newest streamed facts so new nodes appear in view.
watch(() => referral.value.facts.length, () => { if (live.value) graphPage.value = factPageCount.value - 1; });
// When the validated result replaces the live preview, start from the first page again.
watch(live, (now, before) => { if (before && !now) graphPage.value = 0; });
function uncertain(status: string) {
  return ["uncertain", "conflicting", "redacted", "questioned", "concern"].includes(status);
}
function edgeStyle(status: string) {
  return { stroke: ["missing", "not_met"].includes(status) ? "#c34444" : uncertain(status) ? "#b88613" : "#769863",
    strokeDasharray: uncertain(status) ? "6 5" : "0", strokeWidth: 1.7 };
}
const graphNodes = computed<Node[]>(() => {
  const docs = referral.value.documents;
  const hasSections = visibleSections.value.length > 0;
  return [
    ...docs.map((d, i) => ({ id: d.id, type: "document", position: { x: 0, y: 90 + i * 190 }, data: d })),
    ...visibleSections.value.map((section, i) => ({ id: section.id, type: "section", position: { x: 185, y: 30 + i * 150 }, data: section })),
    ...visibleFacts.value.map((f, i) => ({ id: f.id, type: "fact", position: { x: hasSections ? 420 : 235, y: 20 + i * 135 }, data: f })),
  ];
});
const graphEdges = computed<Edge[]>(() => [
  ...visibleSections.value.map(section => ({ id: `${section.document_id}-${section.id}`, source: section.document_id, target: section.id,
    style: edgeStyle(section.status), selected: visibleFacts.value.find(f => f.id === selectedFact.value)?.section_ids?.includes(section.id) })),
  ...visibleFacts.value.flatMap(f => {
    const sources = f.section_ids?.length ? f.section_ids : isPacketMock.value ? referral.value.documents.map(d => d.id) :
      [...new Set(f.evidence_ids.map(id => referral.value.evidence.find(e => e.id === id)?.document_id).filter(Boolean))] as string[];
    return sources.map(source => ({ id: `${source}-${f.id}`, source, target: f.id, selected: f.id === selectedFact.value, style: edgeStyle(f.status) }));
  }),
]);
/** A form node points to the requirements its facts support; it does not open the PDF. */
function openSection(section: { id: string }) {
  selectedFact.value = null;
  closeReview();
  revealRules(referral.value.facts.filter((f) => f.section_ids?.includes(section.id)).flatMap((f) => f.rule_ids));
}
const repairNote = computed(() => referral.value.audit.find((a) => a.type === "validation_repair")?.note || "");
const recommendationLabel = computed(() => referral.value.recommendation?.outcome
  ? `${outcomeLabels[referral.value.recommendation.outcome]}${referral.value.recommendation.stage ? ` · Stage ${referral.value.recommendation.stage}` : ""}` : ({ recommend_approval: "Recommend approval", recommend_denial: "Recommend not approved", needs_information: "More information needed" })[referral.value.recommendation?.status || "needs_information"]);
/** Analyzed and pending applicants use the staged IHH decision tree; demo/mock keep their own groups. */
const treeView = computed(() => referral.value.checklist.rules.length > 0 && referral.value.checklist.rules.every((r) => ruleStep.has(r.id)));
const rulesById = computed(() => new Map(referral.value.checklist.rules.map((r) => [r.id, r])));
const tree = computed(() => evaluateTree(referral.value.checklist.rules));
function stepLabel(step: TreeStep, outcome: StepOutcome) {
  return ({ pass: "Pass", fail: step.failLabel, unresolved: "Needs review", not_reviewed: live.value ? "Waiting for Claude" : "Not reviewed",
    info: step.gate === "context" ? "Context" : "Information", manual: "Coordinator check" } as Record<StepOutcome, string>)[outcome];
}
function rulesOf(step: TreeStep) { return step.rule_ids.map((id) => rulesById.value.get(id)).filter(Boolean) as Rule[]; }
function ruleActive(r: Rule) { return r.fact_ids.includes(selectedFact.value || "") || (review.value?.kind === "rule" && review.value.id === r.id); }
const ruleGroups = computed(() => {
  const groups = new Map<string, Rule[]>();
  referral.value.checklist.rules.forEach((r) => {
    if (!groups.has(r.section)) groups.set(r.section, []);
    groups.get(r.section)!.push(r);
  });
  return [...groups].map(([name, items]) => ({ name, items }));
});
function ruleValue(rule: Rule) {
  const f = referral.value.facts.find((f) => rule.fact_ids.includes(f.id));
  return f ? `${f.value}${f.unit ? " " + f.unit : ""}` : "";
}
function ruleDetail(rule: Rule) {
  const labels: Record<string, string> = {
    pending: "Waiting for Claude…",
    not_reviewed: "Not yet reviewed",
    unknown: isPacketMock.value ? "Not evaluated" : "Not found",
    concern: "Needs clarification",
    not_applicable: "Not applicable",
    met: "Supported",
    missing: "Missing evidence",
    uncertain: "Uncertain · review needed",
    not_met: "Requirement not met",
  };
  return `${labels[rule.status] || rule.status}${ruleValue(rule) ? " · " + ruleValue(rule) : ""}`;
}
function upload(files: FileList | File[] | null) {
  if (!files?.length) return;
  attach(files);
  review.value = null;
  selectedDoc.value = null;
  selectedFact.value = null;
  if (uploadInput.value) uploadInput.value.value = "";
}
function onDrop(e: DragEvent) {
  dragging.value = false;
  upload(e.dataTransfer?.files || null);
}
function demo() {
  resetDemo();
  review.value = null;
  selectedDoc.value = null;
  selectedFact.value = null;
  graphPage.value = 0;
  group.value = "All factors";
}
function openReview(target: ReviewTarget) {
  review.value = target;
  if (target.kind === "fact") selectedFact.value = target.id;
  if (target.kind === "rule") {
    const rule = referral.value.checklist.rules.find((r) => r.id === target.id);
    if (rule?.fact_ids[0] && !rule.fact_ids.includes(target.factId || "")) selectedFact.value = rule.fact_ids[0];
  }
  nextTick(drawOutputs);
}
function closeReview() {
  review.value = null;
  nextTick(drawOutputs);
}
function openDocument(doc: PacketDocument) {
  selectedDoc.value = doc.id;
  openReview({ kind: "document", id: doc.id });
}
/** Rules flashed after a node click; also used for the "not linked" notice. */
const flashedRules = ref(new Set<string>()), linkNotice = ref("");
let flashTimer: ReturnType<typeof setTimeout> | undefined;
/** Scroll Application review to the first of these requirements (expanding its group) and flash them. */
function revealRules(ids: string[]) {
  const wanted = new Set(ids);
  clearTimeout(flashTimer);
  if (!wanted.size) {
    flashedRules.value = new Set();
    linkNotice.value = "This item is not linked to a requirement yet.";
    flashTimer = setTimeout(() => (linkNotice.value = ""), 2500);
    return;
  }
  linkNotice.value = "";
  const groups = new Set(referral.value.checklist.rules.filter((r) => wanted.has(r.id)).flatMap((r) => {
    const place = ruleStep.get(r.id);
    return place ? [place.stage.id, `step-${place.step.id}`] : [r.section];
  }));
  collapsed.value = new Set([...collapsed.value].filter((g) => !groups.has(g)));
  flashedRules.value = wanted;
  nextTick(() => {
    const first = [...document.querySelectorAll<HTMLElement>(".checklist .rule-row")].find((el) => wanted.has(el.id.slice(5)));
    first?.scrollIntoView({ block: "center", behavior: "smooth" });
    setTimeout(drawOutputs, 450);
  });
  flashTimer = setTimeout(() => (flashedRules.value = new Set()), 1800);
}
/** A fact node selects the fact and jumps to its requirements; the PDF opens from a requirement. */
function selectFact(f: Fact) {
  selectedFact.value = f.id;
  closeReview();
  revealRules(f.rule_ids);
}
function inspectRule(r: Rule) {
  openReview({ kind: "rule", id: r.id, factId: r.fact_ids.includes(selectedFact.value || "") ? selectedFact.value! : undefined });
}
function toggleGroup(name: string) {
  const set = new Set(collapsed.value);
  set.has(name) ? set.delete(name) : set.add(name);
  collapsed.value = set;
  nextTick(drawOutputs);
}
const outputWires = ref<{ id: string; d: string; style: ReturnType<typeof edgeStyle> }[]>([]),
  workspaceElement = ref<HTMLElement | null>(null);
function drawOutputs() {
  if (!import.meta.client || !workspaceElement.value || !selectedFact.value) {
    outputWires.value = [];
    return;
  }
  const node = document.getElementById(`fact-${selectedFact.value}`),
    graphEl = document.querySelector(".graph-wrap"),
    panelEl = document.querySelector(".checklist .scroll-body");
  if (!node || !graphEl || !panelEl) {
    outputWires.value = [];
    return;
  }
  const bounds = workspaceElement.value.getBoundingClientRect(),
    a = node.getBoundingClientRect(),
    graph = graphEl.getBoundingClientRect(),
    panel = panelEl.getBoundingClientRect();
  if (a.bottom < graph.top || a.top > graph.bottom || a.right > graph.right) {
    outputWires.value = [];
    return;
  }
  const ids =
    referral.value.facts.find((f) => f.id === selectedFact.value)?.rule_ids ||
    [];
  outputWires.value = ids.flatMap((id) => {
    const el = document.getElementById(`rule-${id}`);
    if (!el) return [];
    const b = el.getBoundingClientRect();
    if (b.top < panel.top || b.bottom > panel.bottom || b.width === 0)
      return [];
    const x = a.right - bounds.left,
      y = a.top + a.height / 2 - bounds.top,
      xx = b.left - bounds.left + 3,
      yy = b.top + b.height / 2 - bounds.top;
    return [
      {
        id,
        style: edgeStyle(referral.value.checklist.rules.find(r => r.id === id)?.status || "uncertain"),
        d: `M${x},${y} C${x + (xx - x) / 2},${y} ${xx - 40},${yy} ${xx},${yy}`,
      },
    ];
  });
}
watch([group, selectedDoc], () => {
  graphPage.value = 0;
});
watch(
  () => visibleFacts.value.map((f) => f.id).join(","),
  () =>
    nextTick(() => {
      fitView({ padding: 0.22, maxZoom: 1, duration: 150 });
      setTimeout(drawOutputs, 180);
    }),
);
watch(() => referral.value.id, () => { selectedFact.value = null; selectedDoc.value = null; review.value = null; group.value = "All factors"; graphPage.value = 0; });
// Reopening/closing the review resizes the graph column; refit once the grid transition settles.
watch(() => review.value === null, () => setTimeout(() => { fitView({ padding: 0.22, maxZoom: 1, duration: 150 }); drawOutputs(); }, 220));
watch(() => referral.value.checklist.rules.map(r => r.status).join(","), () => nextTick(drawOutputs));
onMounted(() => window.addEventListener("resize", drawOutputs));
onBeforeUnmount(() => window.removeEventListener("resize", drawOutputs));
</script>

<template>
  <main ref="workspaceElement" class="workspace" :class="{ reviewing: review }">
    <svg v-if="outputWires.length" class="output-wires" aria-hidden="true">
      <path v-for="wire in outputWires" :key="wire.id" :d="wire.d" :style="wire.style" />
    </svg>
    <section v-show="!review" class="panel documents" aria-labelledby="documents-title">
      <header class="panel-head">
        <div class="eyebrow"><span class="step">01</span> Sources</div>
        <div class="head-row">
          <h1 id="documents-title">Applicant PDF</h1>
          <span class="muted tiny mono">{{
            String(displayedDocuments.length).padStart(2, "0")
          }}</span>
        </div>
      </header>
      <div class="scroll-body">
        <label
          class="upload-area upload-primary"
          :class="{ dragging, disabled: analyzing }"
          @dragover.prevent="dragging = true"
          @dragleave="dragging = false"
          @drop.prevent="onDrop"
          ><input
            ref="uploadInput"
            type="file"
            accept="application/pdf,.pdf"
            class="sr-only"
            :disabled="analyzing"
            @change="upload(($event.target as HTMLInputElement).files)"
          /><Upload :size="20" /><strong>{{ referral.documents.length && mode === 'attached' ? 'Upload another applicant PDF' : 'Upload applicant PDF' }}</strong>
          <span class="tiny muted">Drop or choose one combined PDF (≤ 50 MB). Inline Claude analysis supports PDFs up to 20 MB.</span></label
        >
        <div v-if="analyzing" class="analysis-controls" role="status" aria-live="polite">
          <p class="tiny analysis-progress"><span class="status-dot busy" />{{ progress?.message || "Starting analysis…" }}</p>
          <button class="tiny stop-link" @click="cancelAnalysis">Stop analysis</button>
        </div>
        <div v-if="mode === 'provided'" class="review-field" style="padding: 12px 20px 0">
          <label for="applicant">Or review a provided packet</label>
          <select id="applicant" class="evidence-select" :value="referral.id" :disabled="analyzing" @change="switchApplicant">
            <option v-for="doc in providedDocuments" :key="doc.id" :value="doc.id">{{ doc.name.replace('.pdf', '') }} · separate applicant</option>
          </select>
        </div>
        <div class="files">
          <div v-for="doc in displayedDocuments" :key="doc.id">
            <button
              class="file-row"
              :class="{ active: selectedDoc === doc.id }"
              :aria-pressed="selectedDoc === doc.id"
              @click="openDocument(doc)"
              :aria-label="`Preview ${doc.name}`"
            >
              <span class="file-icon"><FileText :size="17" /></span>
              <div>
                <span class="file-name">{{ doc.name }}</span>
                <div class="file-meta">
                  {{
                    live ? "Claude is reading…" : doc.page_count
                      ? `${doc.page_count} pages · ${doc.status === "analyzed" ? "Claude reviewed" : doc.status === "provided_demo" ? "provided packet" : "example"}`
                      : "Uploaded · not analyzed"
                  }}
                </div>
              </div>
            </button>
          </div>
        </div>
        <div v-if="mode !== 'synthetic' && referral.documents.length && !analyzing" class="source-actions">
          <!-- Provided packets never auto-analyze; uploads do. Retry is always explicit. -->
          <Button v-if="mode === 'provided' || error || referral.status === 'analyzed'" size="sm" :variant="referral.status === 'analyzed' ? 'outline' : 'default'" :disabled="savingPdf" @click="analyze">
            {{ referral.status === 'analyzed' ? 'Analyze again' : error ? 'Retry analysis' : 'Analyze with Claude' }}
          </Button>
          <Button size="sm" variant="ghost" :disabled="savingPdf || !!referral.documents[0]?.storage" @click="savePdf">{{ savingPdf ? 'Saving PDF…' : referral.documents[0]?.storage ? 'PDF saved privately' : 'Save PDF to private storage' }}</Button>
        </div>
        <div v-if="isPacketMock" class="local-label">R01 mock review · based on your packet summary, not extracted findings.</div>
        <div v-if="error" class="error-box" role="alert">{{ error }}</div>
      </div>
      <footer class="panel-foot">
        <span>{{
          referral.status === "awaiting_pdf"
            ? "Needs PDF"
            : live ? "Analyzing with Claude"
            : mode === "provided"
            ? "Provided PDFs"
            : awaitingClaude
              ? "Ready for analysis"
              : referral.status === "analyzed" ? "Claude analysis" : mode === "synthetic" ? "Synthetic flow" : "Attached PDF"
        }}</span>
        <button v-if="mode !== 'synthetic'" @click="demo">
          Synthetic flow
        </button>
        <button v-else-if="providedDocuments.length" @click="showProvided">
          Provided PDFs
        </button>
        <button v-else @click="demo">Reset demo</button>
      </footer>
    </section>
    <section class="panel processor" aria-labelledby="processor-title">
      <header class="panel-head">
        <div class="eyebrow">
          <span class="step">02</span> Extract & connect
        </div>
        <div class="head-row">
          <h2 id="processor-title">Processor</h2>
          <span class="progress-caption"
            ><span class="status-dot" />{{
              analyzing ? `Analyzing · ${referral.facts.length} facts` : referral.status === "awaiting_pdf" ? "Needs PDF" : isPacketMock ? "Mock review" : awaitingClaude ? "Ready" : referral.status === "analyzed" ? "Review required" : "Preview"
            }}</span
          >
        </div>
      </header>
      <div class="graph-toolbar">
        <label class="sr-only" for="factor-group">Information category</label
        ><select id="factor-group" v-model="group">
          <option
            v-for="g in ['All factors', ...new Set(referral.facts.map((f) => f.group))]"
            :key="g"
          >
            {{ g }}
          </option></select
        ><span class="muted tiny">{{ filteredFacts.length }} nodes</span
        ><span style="flex: 1" /><Button
          variant="ghost"
          size="icon"
          class="size-7"
          aria-label="Zoom out"
          @click="zoomOut()"
          ><ZoomOut :size="14" /></Button
        ><Button
          variant="ghost"
          size="icon"
          class="size-7"
          aria-label="Zoom in"
          @click="zoomIn()"
          ><ZoomIn :size="14" /></Button
        ><Button
          variant="ghost"
          size="icon"
          class="size-7"
          aria-label="Fit graph"
          @click="fitView({ padding: 0.22, maxZoom: 1 })"
          ><Maximize :size="14"
        /></Button>
      </div>
      <div class="graph-legend"><span>PDF → forms → facts → application</span><span v-if="live" class="live-key">● Live · provisional nodes</span><span class="missing-key">Red: missing</span><span class="uncertain-key">┄ Yellow: uncertain</span></div>
      <div class="graph-wrap">
        <ClientOnly
          ><VueFlow
            v-if="graphNodes.length"
            :nodes="graphNodes"
            :edges="graphEdges"
            :nodes-connectable="false"
            :min-zoom="0.25"
            :max-zoom="1.6"
            fit-view-on-init
            @move="drawOutputs"
            @move-end="drawOutputs"
            @nodes-initialized="fitView({ padding: 0.22, maxZoom: 1, duration: 150 })"
            @node-drag="drawOutputs"
          >
            <Background :gap="18" :size="0.6" pattern-color="#cbd7c0" />
            <template #node-document="{ data }"
              ><div class="graph-node doc" :class="{ live }">
                <Handle type="source" :position="Position.Right" />
                <div class="node-label">SOURCE PDF</div>
                <div class="node-value">
                  <FileText
                    :size="13"
                    style="display: inline; margin-right: 5px"
                  />{{ data.name }}
                </div>
                <div class="node-meta">
                  {{ data.page_count || "—" }} pages · {{ data.status === "analyzed" ? "Claude" : live ? "Claude reading…" : "source" }}
                </div>
              </div></template
            >
            <template #node-section="{ data }">
              <button class="graph-node form-node" :class="{ live, missing: data.status === 'missing', questioned: data.status === 'uncertain' }" @click="openSection(data)">
                <Handle type="target" :position="Position.Left" /><Handle type="source" :position="Position.Right" />
                <div class="node-label">FORM / SECTION</div>
                <div class="node-value">{{ data.title }}</div>
                <div class="node-meta">{{ data.pages.length ? `Pages ${data.pages.join(', ')}` : 'Not found in PDF' }}</div>
                <div class="node-meta">{{ data.status }}</div>
              </button>
            </template>
            <template #node-fact="{ data }"
              ><button
                :id="`fact-${data.id}`"
                class="graph-node"
                :class="{
                  live,
                  selected: selectedFact === data.id,
                  questioned: uncertain(data.status),
                  missing: data.status === 'missing',
                }"
                @click="selectFact(data)"
              >
                <Handle type="target" :position="Position.Left" /><Handle
                  type="source"
                  :position="Position.Right"
                />
                <div class="node-label">{{ data.label }}</div>
                <div class="node-value">
                  {{ data.value || (data.status === "redacted" ? "Redacted" : "Missing") }} <span v-if="data.unit">{{ data.unit }}</span>
                </div>
                <div class="node-meta">
                  {{ isPacketMock ? "Mock · supplied packet summary" : `${data.evidence_ids.length} source${data.evidence_ids.length === 1 ? '' : 's'}` }}
                </div>
                <span v-if="selectedFact === data.id" class="node-review">{{ data.rule_ids.length ? `${data.rule_ids.length} linked requirement${data.rule_ids.length === 1 ? "" : "s"} →` : "No linked requirement" }}</span>
              </button></template
            >
          </VueFlow></ClientOnly
        >
        <div v-if="!graphNodes.length" class="graph-empty">
          <div class="empty-diagram">
            <span class="empty-box"><FileText :size="20" /></span
            ><ArrowRight :size="18" /><span class="empty-box">Aa</span
            ><ArrowRight :size="18" /><span class="empty-box"
              ><Check :size="20"
            /></span>
          </div>
          <p>
            PDF → forms → patient facts → application<br /><br />{{
              referral.status === "awaiting_pdf"
                ? "Attach one combined PDF to begin this applicant’s review."
                : awaitingClaude
                  ? "Enter a patient name and choose Analyze with Claude."
                  : "No nodes in this selection."
            }}
          </p>
        </div>
      </div>
      <footer class="panel-foot">
        <span>Node → its requirement · requirement → source PDF</span>
        <div class="button-row">
          <Button
            variant="ghost"
            size="icon"
            class="size-6"
            aria-label="Previous information nodes"
            :disabled="graphPage === 0"
            @click="graphPage--"
            ><ChevronRight
              :size="12"
              style="transform: rotate(180deg)" /></Button
          ><span class="mono">{{ graphPage + 1 }} / {{ factPageCount }}</span
          ><Button
            variant="ghost"
            size="icon"
            class="size-6"
            aria-label="Next information nodes"
            :disabled="graphPage + 1 >= factPageCount"
            @click="graphPage++"
            ><ChevronRight :size="12"
          /></Button>
        </div>
      </footer>
    </section>
    <section class="panel checklist" aria-labelledby="checklist-title">
      <header class="panel-head">
        <div class="eyebrow"><span class="step">03</span> Result</div>
        <div class="head-row">
          <h2 id="checklist-title">Application review</h2>
          <span class="muted tiny mono"
            >{{ confirmedRules }} / {{ applicableRules }}</span
          >
        </div>
      </header>
      <div v-if="linkNotice" class="link-notice" role="status">{{ linkNotice }}</div>
      <div class="scroll-body" @scroll="drawOutputs">
        <div v-if="referral.recommendation" class="recommendation" :class="referral.recommendation.status" role="status">
          <strong>{{ recommendationLabel }}</strong>
          <p>Claude recommendation · coordinator confirms the final decision.</p>
          <details><summary>Decision path · {{ referral.recommendation.rule_ids.length }} linked criteria</summary>
            <p v-for="(reason, i) in referral.recommendation.reasons" :key="i">{{ reason }}</p>
          </details>
        </div>
        <details v-if="repairNote" class="criteria-note"><summary>Validation repairs applied</summary><p>{{ repairNote }}</p></details>
        <details v-if="referral.checklist.source_url" class="criteria-note"><summary>Criteria & precedence</summary><p>{{ referral.checklist.precedence }}</p><a :href="referral.checklist.source_url" target="_blank" rel="noreferrer">Source criteria ↗</a></details>
        <div v-if="isPacketMock" class="intro-label">
          Mock checklist · document presence only. Clinical eligibility is not assessed.
          Historical IHH outcome: deny; reason not recorded. This label does not drive the checklist.
        </div>
        <div v-if="live" class="intro-label live-label" role="status">
          <span class="status-dot busy" />{{ referral.checklist.rules.length
            ? `Claude is reviewing criteria · ${referral.checklist.rules.filter(r => r.status !== 'pending').length} / ${referral.checklist.rules.length}`
            : "Requirements are reviewed after Claude finishes reading forms and facts." }}
          Provisional until the full result passes validation.
        </div>
        <template v-if="treeView">
          <div v-if="!referral.recommendation" class="recommendation tree-outcome" :class="tree.outcome" role="status">
            <strong>{{ live ? `Provisional · ${outcomeLabels[tree.outcome]}` : outcomeLabels[tree.outcome] }}{{ tree.stage ? ` · Stage ${tree.stage.number}` : "" }}</strong>
            <p>{{ tree.outcome === "not_reviewed" ? "Every IHH criterion is listed below. Analyze the PDF to evaluate each stage and link evidence." : "Staged IHH decision tree · coordinator confirms the final decision." }}</p>
          </div>
          <div v-for="s in tree.stages" :key="s.stage.id" class="group stage">
            <button class="group-header" :aria-expanded="!collapsed.has(s.stage.id)" @click="toggleGroup(s.stage.id)">
              <ChevronRight v-if="collapsed.has(s.stage.id)" :size="12" class="muted" /><ChevronDown v-else :size="12" class="muted" />
              <span class="stage-number mono">{{ s.stage.number }}</span>
              <span class="group-title">{{ s.stage.title }}</span>
              <span class="stage-badge" :class="s.outcome">{{ s.outcome === "not_reviewed" && live ? "Waiting for Claude" : outcomeLabels[s.outcome] }}</span>
            </button>
            <div v-if="!collapsed.has(s.stage.id)" class="stage-body">
              <p class="stage-summary">{{ s.stage.summary }}</p>
              <div v-for="st in s.steps" :key="st.step.id" class="tree-step" :class="st.outcome">
                <button class="step-header" :aria-expanded="!collapsed.has(`step-${st.step.id}`)" @click="toggleGroup(`step-${st.step.id}`)">
                  <span class="mono step-id">{{ st.step.id }}</span>
                  <span class="step-title">{{ st.step.title }}</span>
                  <span class="step-badge" :class="st.outcome">{{ stepLabel(st.step, st.outcome) }}</span>
                </button>
                <p class="step-question">{{ st.step.question }}<template v-if="st.step.failLabel"> If not → {{ st.step.failLabel }}.</template></p>
                <p v-if="st.step.gate === 'manual'" class="step-manual">Not in the pinned criteria · the coordinator verifies this check.</p>
                <template v-else-if="!collapsed.has(`step-${st.step.id}`)">
                  <RuleRow v-for="r in rulesOf(st.step)" :key="r.id" :rule="r" :detail="ruleDetail(r)" :show-note="referral.status === 'analyzed'"
                    :active="ruleActive(r)" :flash="flashedRules.has(r.id)" @inspect="inspectRule" />
                </template>
                <button v-else class="step-more" @click="toggleGroup(`step-${st.step.id}`)">Show {{ st.step.rule_ids.length }} criteria</button>
              </div>
            </div>
          </div>
        </template>
        <div v-for="g in ruleGroups" v-else :key="g.name" class="group">
          <button
            class="group-header"
            :aria-expanded="!collapsed.has(g.name)"
            @click="toggleGroup(g.name)"
          >
            <ChevronRight
              v-if="collapsed.has(g.name)"
              :size="12"
              class="muted"
            /><ChevronDown v-else :size="12" class="muted" /><span
              class="group-title"
              >{{ g.name }}</span
            ><span class="group-count mono"
              >{{ g.items.filter((r) => r.status === "met").length }} /
              {{
                g.items.filter((r) => r.status !== "not_applicable").length
              }}</span
            >
          </button>
          <div class="progress-track">
            <span
              :style="{
                width: `${(100 * g.items.filter((r) => r.status === 'met').length) / (g.items.filter((r) => r.status !== 'not_applicable').length || 1)}%`,
              }"
            />
          </div>
          <div v-if="!collapsed.has(g.name)">
            <RuleRow v-for="r in g.items" :key="r.id" :rule="r" :detail="ruleDetail(r)" :show-note="referral.status === 'analyzed'"
              :active="ruleActive(r)" :flash="flashedRules.has(r.id)" @inspect="inspectRule" />
          </div>
        </div>
      </div>
      <footer class="panel-foot">
        <span>{{ treeView ? "IHH decision tree · 6 stages" : "Linked to sources" }}</span><span>{{ referral.status === "analyzed" ? "Coordinator review" : treeView ? `${referral.checklist.rules.length} criteria` : "Example checklist" }}</span>
      </footer>
    </section>
    <SourceReviewPanel v-if="review" :target="review" @close="closeReview" @select="openReview" />
  </main>
</template>
<style scoped>
.output-wires {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 10;
  overflow: visible;
}
.output-wires path {
  fill: none;
  stroke: #769863;
  stroke-width: 1.3;
  opacity: 0.8;
}
.workspace {
  position: relative;
}
.node-review {
  display: block;
  border-top: 1px solid #e8eee1;
  padding-top: 8px;
  margin-top: 10px;
  font-size: 10px;
  color: #63834f;
}
@media (max-width: 850px) {
  .output-wires {
    display: none;
  }
}
</style>
