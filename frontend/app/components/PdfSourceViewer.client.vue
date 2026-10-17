<script setup lang="ts">
import { ChevronUp, ChevronDown, Crosshair, ExternalLink } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

/**
 * Continuous PDF.js viewer: every page is laid out at its true aspect ratio and
 * rendered lazily as it nears the viewport. No text extraction or OCR.
 */
const props = withDefaults(
  defineProps<{
    url: string;
    title: string;
    /** Page to bring into view; changes (or `focusKey` changes) scroll to it. */
    page?: number;
    bbox?: [number, number, number, number] | null;
    /** Pages cited by the current selection, outlined in the scroll. */
    citedPages?: number[];
    focusKey?: string | number;
    /** Caption for a shown highlight, e.g. that its position is model-estimated. */
    boxNote?: string;
  }>(),
  { page: 1, bbox: null, citedPages: () => [], focusKey: 0, boxNote: "" },
);
const PAD = 14, GAP = 14;
const container = ref<HTMLElement | null>(null);
const sizes = shallowRef<{ width: number; height: number }[]>([]);
const width = ref(0), currentPage = ref(1), loading = ref(true), error = ref("");
const pageElements = new Map<number, HTMLElement>(), canvases = new Map<number, HTMLCanvasElement>();
const rendered = new Map<number, number>(), tasks = new Map<number, RenderTask>(), nearby = new Set<number>();
let pdf: PDFDocumentProxy | null = null, task: PDFDocumentLoadingTask | null = null, generation = 0;
let intersection: IntersectionObserver | null = null, resize: ResizeObserver | null = null;
let resizeTimer: ReturnType<typeof setTimeout> | undefined;

const pageCount = computed(() => sizes.value.length);
const cited = computed(() => new Set(props.citedPages));
const validBox = computed(() => {
  const b = props.bbox;
  return b && b.every(Number.isFinite) && b[0] >= 0 && b[1] >= 0 && b[2] <= 1 && b[3] <= 1 && b[2] > b[0] && b[3] > b[1] ? b : null;
});
const target = computed(() => Math.max(1, Math.min(props.page, pageCount.value || props.page)));
function cssSize(n: number) {
  const size = sizes.value[n - 1];
  if (!size || !width.value) return { width: "100%", height: "0px" };
  return { width: `${width.value}px`, height: `${(size.height * width.value) / size.width}px` };
}
function setPageElement(n: number, el: Element | null) {
  const previous = pageElements.get(n);
  if (previous === el) return;
  if (previous) intersection?.unobserve(previous);
  if (el) { pageElements.set(n, el as HTMLElement); intersection?.observe(el); }
  else pageElements.delete(n);
}
function setCanvas(n: number, el: Element | null) {
  if (el) canvases.set(n, el as HTMLCanvasElement); else canvases.delete(n);
}
async function renderPage(n: number) {
  const canvas = canvases.get(n), version = generation, renderWidth = width.value;
  if (!pdf || !canvas || !renderWidth || rendered.get(n) === renderWidth) return;
  rendered.set(n, renderWidth);
  tasks.get(n)?.cancel();
  try {
    const page = await pdf.getPage(n);
    if (version !== generation || rendered.get(n) !== renderWidth) return;
    const viewport = page.getViewport({ scale: renderWidth / page.getViewport({ scale: 1 }).width });
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    const job = page.render({ canvas, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
    tasks.set(n, job);
    await job.promise;
    if (tasks.get(n) === job) tasks.delete(n);
  } catch (e) {
    if ((e as Error).name !== "RenderingCancelledException" && version === generation) rendered.delete(n);
  }
}
/** Release far-away canvases so long packets do not hold every bitmap in memory. */
function releasePage(n: number) {
  tasks.get(n)?.cancel();
  tasks.delete(n);
  rendered.delete(n);
  const canvas = canvases.get(n);
  if (canvas) { canvas.width = 0; canvas.height = 0; }
}
function measure() {
  if (container.value) width.value = Math.max(220, container.value.clientWidth - PAD * 2);
}
function updateCurrentPage() {
  const el = container.value;
  if (!el || !pageCount.value) return;
  const probe = el.scrollTop + el.clientHeight * 0.35;
  let page = 1;
  for (const [n, pageEl] of pageElements) if (pageEl.offsetTop <= probe && n > page) page = n;
  currentPage.value = page;
}
function scrollToPage(n: number, smooth = true) {
  const el = container.value, pageEl = pageElements.get(n);
  if (!el || !pageEl) return;
  const box = n === target.value ? validBox.value : null;
  const offset = box ? box[1] * pageEl.offsetHeight - el.clientHeight * 0.3 : -GAP / 2;
  el.scrollTo({ top: Math.max(0, pageEl.offsetTop + offset), behavior: smooth ? "smooth" : "auto" });
}
async function load() {
  const version = ++generation;
  tasks.forEach((t) => t.cancel());
  tasks.clear(); rendered.clear(); nearby.clear();
  await task?.destroy();
  pdf = null; sizes.value = []; loading.value = true; error.value = "";
  try {
    const pdfjs = await import("pdfjs-dist");
    if (version !== generation) return;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    const loadingTask = (task = pdfjs.getDocument({ url: props.url, useSystemFonts: true }));
    const document = await loadingTask.promise;
    if (version !== generation) return void loadingTask.destroy();
    const pages = await Promise.all(Array.from({ length: document.numPages }, (_, i) =>
      document.getPage(i + 1).then((p) => p.getViewport({ scale: 1 }))));
    if (version !== generation) return;
    pdf = document;
    measure();
    sizes.value = pages.map((v) => ({ width: v.width, height: v.height }));
    loading.value = false;
    await nextTick();
    scrollToPage(target.value, false);
    updateCurrentPage();
  } catch {
    if (version !== generation) return;
    loading.value = false;
    error.value = "This PDF could not be displayed. Try opening the original file.";
  }
}
watch(() => props.url, load);
watch(() => [props.page, props.focusKey, props.bbox], () => nextTick(() => scrollToPage(target.value)), { deep: true });
onMounted(() => {
  intersection = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const n = Number((entry.target as HTMLElement).dataset.page);
      if (entry.isIntersecting) { nearby.add(n); renderPage(n); }
      else { nearby.delete(n); releasePage(n); }
    }
  }, { root: container.value, rootMargin: "900px 0px" });
  pageElements.forEach((el) => intersection!.observe(el));
  resize = new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const before = width.value;
      measure();
      if (before === width.value) return;
      const keep = currentPage.value;
      nextTick(() => { scrollToPage(keep, false); nearby.forEach(renderPage); });
    }, 120);
  });
  if (container.value) resize.observe(container.value);
  load();
});
onBeforeUnmount(() => {
  ++generation;
  clearTimeout(resizeTimer);
  intersection?.disconnect();
  resize?.disconnect();
  tasks.forEach((t) => t.cancel());
  task?.destroy();
});
</script>

<template>
  <div class="pdf-viewer">
    <div class="pdf-toolbar">
      <span class="pdf-title">{{ title }}</span>
      <span class="mono">Page {{ currentPage }}<span v-if="pageCount"> / {{ pageCount }}</span></span>
      <div class="pdf-actions">
        <Button variant="ghost" size="icon" class="size-7" aria-label="Previous PDF page" :disabled="loading || currentPage <= 1" @click="scrollToPage(currentPage - 1)"><ChevronUp :size="14" /></Button>
        <Button variant="ghost" size="icon" class="size-7" aria-label="Next PDF page" :disabled="loading || currentPage >= pageCount" @click="scrollToPage(currentPage + 1)"><ChevronDown :size="14" /></Button>
        <Button variant="ghost" size="icon" class="size-7" :aria-label="`Return to page ${target}`" :disabled="loading" @click="scrollToPage(target)"><Crosshair :size="14" /></Button>
        <Button variant="ghost" size="icon" class="size-7" as-child><a :href="`${url}#page=${currentPage}`" target="_blank" rel="noopener" aria-label="Open original PDF"><ExternalLink :size="14" /></a></Button>
      </div>
    </div>
    <div v-if="error" class="pdf-error" role="alert">{{ error }}</div>
    <div ref="container" class="pdf-scroll" :aria-busy="loading" @scroll.passive="updateCurrentPage">
      <span v-if="loading" class="pdf-loading" role="status">Loading PDF…</span>
      <div
        v-for="n in pageCount"
        :key="n"
        :ref="(el) => setPageElement(n, el as Element | null)"
        :data-page="n"
        class="pdf-page"
        :class="{ cited: cited.has(n), target: n === target }"
        :style="cssSize(n)"
      >
        <canvas :ref="(el) => setCanvas(n, el as Element | null)" :aria-label="`${title}, page ${n}`" role="img" />
        <span class="pdf-page-label">{{ n }}<template v-if="cited.has(n)"> · cited</template></span>
        <div
          v-if="n === target && validBox"
          class="pdf-highlight"
          aria-label="Highlighted source passage"
          :style="{ left: `${validBox[0] * 100}%`, top: `${validBox[1] * 100}%`, width: `${(validBox[2] - validBox[0]) * 100}%`, height: `${(validBox[3] - validBox[1]) * 100}%` }"
        />
      </div>
    </div>
    <div v-if="!validBox" class="pdf-anchor-note">Cited pages are outlined · no passage highlight for this citation.</div>
    <div v-else-if="boxNote" class="pdf-anchor-note">{{ boxNote }}</div>
  </div>
</template>

<style scoped>
.pdf-viewer { min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.pdf-toolbar { display: flex; align-items: center; gap: 10px; font-size: 11px; color: #738168; margin-bottom: 8px; }
.pdf-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pdf-actions { display: flex; gap: 2px; flex-shrink: 0; }
.pdf-scroll { position: relative; flex: 1; background: #edf0e9; border: 1px solid #dce3d5; border-radius: 8px; min-height: 240px; overflow-y: auto; overflow-x: hidden; scrollbar-gutter: stable; padding: 14px; display: flex; flex-direction: column; align-items: center; gap: 14px; }
.pdf-page { position: relative; flex-shrink: 0; background: white; box-shadow: 0 2px 7px #29391a15; }
.pdf-page canvas { display: block; width: 100%; height: 100%; }
.pdf-page.cited { outline: 2px solid #c49a47; outline-offset: 2px; }
.pdf-page.target { outline-width: 3px; }
.pdf-page-label { position: absolute; top: 6px; right: 6px; font-size: 10px; padding: 2px 6px; border-radius: 4px; background: #2f3d27b3; color: white; pointer-events: none; }
.pdf-page.cited .pdf-page-label { background: #a57c24; }
.pdf-highlight { position: absolute; border: 2px solid #b28c39; background: #f4cb543f; pointer-events: none; border-radius: 3px; box-shadow: 0 0 0 2px #ffffff80; }
.pdf-loading { font-size: 12px; color: #88957e; padding: 16px; }
.pdf-error { font-size: 12px; padding: 15px; background: #fff4ea; border-radius: 6px; margin-bottom: 10px; }
.pdf-anchor-note { font-size: 10px; color: #8d9982; margin-top: 8px; }
</style>
