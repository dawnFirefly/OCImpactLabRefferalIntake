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
  Plus,
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
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { Fact, Rule, Evidence, PacketDocument } from "./types";

const { referral, error, resetDemo, attach, updateFact, updateRule } =
  useReviewWorkspace();
const selectedDoc = ref<string | null>(null),
  selectedFact = ref<string | null>(null);
const group = ref("All factors"),
  graphPage = ref(0),
  collapsed = ref(new Set<string>());
const dragging = ref(false),
  uploadInput = ref<HTMLInputElement | null>(null);
const modal = ref(false),
  factEdit = ref<Fact | null>(null),
  ruleEdit = ref<Rule | null>(null);
const editValue = ref(""),
  editNote = ref(""),
  reviewStatus = ref("met"),
  reviewError = ref(""),
  evidenceIndex = ref(0);
const previewDocument = ref<PacketDocument | null>(null),
  previewOpen = ref(false);
const { fitView, zoomIn, zoomOut } = useVueFlow();
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
      (!selectedDoc.value ||
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
const graphNodes = computed<Node[]>(() => {
  const docIds = new Set(
    visibleFacts.value.flatMap((f) =>
      f.evidence_ids.map(
        (id) => referral.value.evidence.find((e) => e.id === id)?.document_id,
      ),
    ),
  );
  const docs = referral.value.documents.filter((d) => docIds.has(d.id));
  return [
    ...docs.map((d, i) => ({
      id: d.id,
      type: "document",
      position: { x: 20, y: 40 + i * 190 },
      data: d,
    })),
    ...visibleFacts.value.map((f, i) => ({
      id: f.id,
      type: "fact",
      position: { x: 285, y: 20 + i * 123 },
      data: f,
    })),
  ];
});
const graphEdges = computed<Edge[]>(() =>
  visibleFacts.value.flatMap((f) => {
    const docs = [
      ...new Set(
        f.evidence_ids
          .map(
            (id) =>
              referral.value.evidence.find((e) => e.id === id)?.document_id,
          )
          .filter(Boolean),
      ),
    ] as string[];
    return docs.map((d) => ({
      id: `${d}-${f.id}`,
      source: d,
      target: f.id,
      type: "default",
      selected: f.id === selectedFact.value,
    }));
  }),
);
const ruleGroups = computed(() => {
  const groups = new Map<string, Rule[]>();
  referral.value.checklist.rules.forEach((r) => {
    if (!groups.has(r.section)) groups.set(r.section, []);
    groups.get(r.section)!.push(r);
  });
  return [...groups].map(([name, items]) => ({ name, items }));
});
const linkedEvidence = computed<Evidence[]>(() => {
  const ids = factEdit.value
    ? factEdit.value.evidence_ids
    : (ruleEdit.value?.fact_ids || []).flatMap(
        (fid) =>
          referral.value.facts.find((f) => f.id === fid)?.evidence_ids || [],
      );
  return [...new Set(ids)]
    .map((id) => referral.value.evidence.find((e) => e.id === id))
    .filter(Boolean) as Evidence[];
});
const currentEvidence = computed(
  () => linkedEvidence.value[evidenceIndex.value],
);
const currentDocument = computed(() =>
  referral.value.documents.find(
    (d) => d.id === currentEvidence.value?.document_id,
  ),
);
function ruleValue(rule: Rule) {
  const f = referral.value.facts.find((f) => rule.fact_ids.includes(f.id));
  return f ? `${f.value}${f.unit ? " " + f.unit : ""}` : "";
}
function ruleDetail(rule: Rule) {
  const labels: Record<string, string> = {
    unknown: "Not found",
    concern: "Needs clarification",
    not_applicable: "Not applicable",
  };
  return ruleValue(rule) || labels[rule.status] || "";
}
function upload(files: FileList | File[] | null) {
  if (!files?.length) return;
  attach(files);
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
  selectedDoc.value = null;
  selectedFact.value = null;
  graphPage.value = 0;
  group.value = "All factors";
}
function selectFact(f: Fact) {
  selectedFact.value = f.id;
  nextTick(drawOutputs);
}
function inspectFact(f: Fact) {
  factEdit.value = f;
  ruleEdit.value = null;
  editValue.value = f.value;
  editNote.value = f.review_note;
  evidenceIndex.value = 0;
  reviewError.value = "";
  modal.value = true;
}
function inspectRule(r: Rule) {
  ruleEdit.value = r;
  factEdit.value = null;
  editNote.value = r.note;
  reviewStatus.value = ["met", "concern", "not_applicable"].includes(r.status)
    ? r.status
    : "unknown";
  evidenceIndex.value = 0;
  reviewError.value = "";
  modal.value = true;
  if (r.fact_ids[0]) selectedFact.value = r.fact_ids[0];
}
function saveReview(status = "confirmed") {
  if (editNote.value.trim().length < 3) {
    reviewError.value = "Add a short note explaining the adjustment.";
    return;
  }
  if (factEdit.value) {
    if (!editValue.value.trim()) {
      reviewError.value = "Enter a value.";
      return;
    }
    updateFact(factEdit.value, editValue.value.trim(), editNote.value, status);
  } else if (ruleEdit.value)
    updateRule(ruleEdit.value, reviewStatus.value, editNote.value);
  modal.value = false;
}
function toggleGroup(name: string) {
  const set = new Set(collapsed.value);
  set.has(name) ? set.delete(name) : set.add(name);
  collapsed.value = set;
  nextTick(drawOutputs);
}
const outputWires = ref<{ id: string; d: string }[]>([]),
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
onMounted(() => window.addEventListener("resize", drawOutputs));
onBeforeUnmount(() => window.removeEventListener("resize", drawOutputs));
</script>

<template>
  <main ref="workspaceElement" class="workspace">
    <svg v-if="outputWires.length" class="output-wires" aria-hidden="true">
      <path v-for="wire in outputWires" :key="wire.id" :d="wire.d" />
    </svg>
    <section class="panel documents" aria-labelledby="documents-title">
      <header class="panel-head">
        <div class="eyebrow"><span class="step">01</span> Sources</div>
        <div class="head-row">
          <h1 id="documents-title">Documents</h1>
          <span class="muted tiny mono">{{
            String(referral.documents.length).padStart(2, "0")
          }}</span>
        </div>
      </header>
      <div class="scroll-body">
        <div class="files">
          <div v-for="doc in referral.documents" :key="doc.id">
            <button
              class="file-row"
              :class="{ active: selectedDoc === doc.id }"
              :aria-pressed="selectedDoc === doc.id"
              @click="selectedDoc = selectedDoc === doc.id ? null : doc.id"
            >
              <span class="file-icon"><FileText :size="17" /></span>
              <div>
                <span class="file-name">{{ doc.name }}</span>
                <div class="file-meta">
                  {{
                    doc.page_count
                      ? `${doc.page_count} pages · example`
                      : "Attached · awaiting Claude"
                  }}
                </div>
              </div></button
            ><Button
              v-if="doc.local_url"
              variant="ghost"
              size="sm"
              class="mb-2 ml-2"
              @click="
                previewDocument = doc;
                previewOpen = true;
              "
              >Preview PDF</Button
            >
          </div>
        </div>
        <label
          class="upload-area"
          :class="{ dragging }"
          @dragover.prevent="dragging = true"
          @dragleave="dragging = false"
          @drop.prevent="onDrop"
          ><input
            ref="uploadInput"
            type="file"
            accept="application/pdf,.pdf"
            multiple
            class="sr-only"
            @change="upload(($event.target as HTMLInputElement).files)"
          /><Plus :size="18" /><span>Add PDFs</span></label
        >
        <div v-if="awaitingClaude" class="local-label">
          Files are attached in this browser session.<br />Claude analysis will
          be connected later.
        </div>
        <div v-if="error" class="error-box" role="alert">{{ error }}</div>
      </div>
      <footer class="panel-foot">
        <span>{{
          awaitingClaude ? "Awaiting integration" : "Synthetic demo"
        }}</span
        ><button @click="demo">Reset demo</button>
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
              awaitingClaude ? "Awaiting Claude" : "Preview"
            }}</span
          >
        </div>
      </header>
      <div class="graph-toolbar">
        <label class="sr-only" for="factor-group">Information category</label
        ><select id="factor-group" v-model="group">
          <option
            v-for="g in [
              'All factors',
              'Personal information',
              'Labs & vitals',
            ]"
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
            @nodes-initialized="drawOutputs"
            @node-drag="drawOutputs"
          >
            <Background :gap="18" :size="0.6" pattern-color="#cbd7c0" />
            <template #node-document="{ data }"
              ><div class="graph-node doc">
                <Handle type="source" :position="Position.Right" />
                <div class="node-label">SOURCE PDF</div>
                <div class="node-value">
                  <FileText
                    :size="13"
                    style="display: inline; margin-right: 5px"
                  />{{ data.name }}
                </div>
                <div class="node-meta">
                  {{ data.page_count }} pages · example
                </div>
              </div></template
            >
            <template #node-fact="{ data }"
              ><button
                :id="`fact-${data.id}`"
                class="graph-node"
                :class="{
                  selected: selectedFact === data.id,
                  questioned: data.status === 'questioned',
                }"
                @click="selectFact(data)"
                @dblclick="inspectFact(data)"
                @keydown.enter.prevent="inspectFact(data)"
              >
                <Handle type="target" :position="Position.Left" /><Handle
                  type="source"
                  :position="Position.Right"
                />
                <div class="node-label">{{ data.label }}</div>
                <div class="node-value">
                  {{ data.value }} <span v-if="data.unit">{{ data.unit }}</span>
                </div>
                <div class="node-meta">
                  {{ data.evidence_ids.length }} source{{
                    data.evidence_ids.length === 1 ? "" : "s"
                  }}
                </div>
                <span
                  v-if="selectedFact === data.id"
                  class="node-review"
                  @click.stop="inspectFact(data)"
                  >Review / adjust →</span
                >
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
            PDFs → patient information → checklist<br /><br />{{
              awaitingClaude
                ? "Your files are ready for the future Claude integration."
                : "No nodes in this selection."
            }}
          </p>
        </div>
      </div>
      <footer class="panel-foot">
        <span>Click to trace · double-click to adjust</span>
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
          <h2 id="checklist-title">Checklist</h2>
          <span class="muted tiny mono"
            >{{ confirmedRules }} / {{ applicableRules }}</span
          >
        </div>
      </header>
      <div class="scroll-body" @scroll="drawOutputs">
        <div v-if="awaitingClaude" class="intro-label">
          Checklist results will appear after Claude analysis is connected.
        </div>
        <div v-for="g in ruleGroups" :key="g.name" class="group">
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
            <button
              v-for="r in g.items"
              :id="`rule-${r.id}`"
              :key="r.id"
              class="rule-row"
              :class="{ active: r.fact_ids.includes(selectedFact || '') }"
              @click="inspectRule(r)"
            >
              <div style="min-width: 0">
                <span class="rule-text">{{ r.text }}</span>
                <div class="rule-state" :class="r.status">
                  {{ ruleDetail(r) }}
                </div>
              </div>
              <Check
                v-if="r.status === 'met'"
                :size="13"
                class="rule-symbol"
              /><AlertCircle
                v-else-if="r.status === 'concern'"
                :size="13"
                class="rule-symbol"
              /><Minus v-else :size="12" class="rule-symbol" />
            </button>
          </div>
        </div>
      </div>
      <footer class="panel-foot">
        <span>Linked to sources</span><span>Example checklist</span>
      </footer>
    </section>
    <Dialog v-model:open="modal"
      ><DialogContent class="inspector"
        ><DialogHeader
          ><DialogTitle>{{ factEdit?.label || ruleEdit?.text }}</DialogTitle
          ><DialogDescription
            >Inspect and adjust the synthetic example. Changes last for this
            browser session.</DialogDescription
          ></DialogHeader
        >
        <div class="inspector-grid">
          <div>
            <div v-if="currentEvidence" class="page-nav">
              <span class="tiny muted"
                >{{ currentDocument?.name }} · page
                {{ currentEvidence.page }}</span
              >
              <div class="button-row">
                <Button
                  variant="outline"
                  size="sm"
                  :disabled="evidenceIndex === 0"
                  @click="evidenceIndex--"
                  >←</Button
                ><span class="tiny"
                  >{{ evidenceIndex + 1 }} / {{ linkedEvidence.length }}</span
                ><Button
                  variant="outline"
                  size="sm"
                  :disabled="evidenceIndex + 1 >= linkedEvidence.length"
                  @click="evidenceIndex++"
                  >→</Button
                >
              </div>
            </div>
            <div v-if="currentEvidence" class="evidence-quote">
              {{ currentEvidence.quote }}
            </div>
            <div v-else class="empty-evidence">
              No supporting information in this example.
            </div>
            <p class="audit-note">
              Synthetic source excerpt. Real PDF reading, exact highlights, and
              streaming results will come from the future Claude integration.
            </p>
          </div>
          <div>
            <div v-if="factEdit" class="review-field">
              <label for="fact-value">Value</label
              ><Textarea id="fact-value" v-model="editValue" />
              <p
                v-if="factEdit.value !== factEdit.original_value"
                class="correction"
              >
                Original: {{ factEdit.original_value }}
              </p>
            </div>
            <div v-if="ruleEdit" class="review-field">
              <label for="rule-status">Checklist status</label
              ><select
                id="rule-status"
                v-model="reviewStatus"
                class="evidence-select"
              >
                <option value="met">Completed</option>
                <option value="concern">Needs clarification</option>
                <option value="not_applicable">Not applicable</option>
                <option value="unknown">Unknown</option>
              </select>
            </div>
            <div class="review-field">
              <label for="review-note">Adjustment note</label
              ><Textarea
                id="review-note"
                v-model="editNote"
                placeholder="Why is this adjustment needed?"
              />
            </div>
            <p v-if="reviewError" class="error-box" role="alert">
              {{ reviewError }}
            </p>
            <div class="dialog-actions">
              <Button @click="saveReview()">Save adjustment</Button
              ><Button
                v-if="factEdit"
                variant="outline"
                @click="saveReview('questioned')"
                >Flag for clarification</Button
              >
            </div>
          </div>
        </div></DialogContent
      ></Dialog
    >
    <Dialog v-model:open="previewOpen"
      ><DialogContent class="inspector"
        ><DialogHeader
          ><DialogTitle>{{ previewDocument?.name }}</DialogTitle
          ><DialogDescription
            >Browser preview only. This file has not been analyzed or sent to a
            model.</DialogDescription
          ></DialogHeader
        ><iframe
          v-if="previewDocument?.local_url"
          :src="previewDocument.local_url"
          title="Attached PDF preview"
          style="
            width: 100%;
            height: 65vh;
            border: 1px solid #ddd;
          " /></DialogContent
    ></Dialog>
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
