<script setup lang="ts">
import { Button } from "@/components/ui/button";
import type {
  PDFDocumentProxy,
  PDFDocumentLoadingTask,
  RenderTask,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

const props = withDefaults(
  defineProps<{
    url: string;
    title: string;
    page?: number;
    bbox?: [number, number, number, number] | null;
  }>(),
  { page: 1, bbox: null },
);
const container = ref<HTMLElement | null>(null),
  pageElement = ref<HTMLElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null),
  highlight = ref<HTMLElement | null>(null);
const currentPage = ref(props.page),
  pageCount = ref(0),
  loading = ref(true),
  error = ref("");
let pdf: PDFDocumentProxy | null = null,
  task: PDFDocumentLoadingTask | null = null;
let renderTask: RenderTask | null = null,
  generation = 0,
  renderGeneration = 0;
let observer: ResizeObserver | null = null,
  resizeTimer: ReturnType<typeof setTimeout> | undefined;
const activeBox = computed(() =>
  currentPage.value === props.page ? props.bbox : null,
);
const validBox = computed(() => {
  const b = activeBox.value;
  return b &&
    b.every(Number.isFinite) &&
    b[0] >= 0 &&
    b[1] >= 0 &&
    b[2] <= 1 &&
    b[3] <= 1 &&
    b[2] > b[0] &&
    b[3] > b[1]
    ? b
    : null;
});
async function render() {
  if (!pdf || !canvas.value || !container.value) return;
  const version = ++renderGeneration;
  const previous = renderTask;
  previous?.cancel();
  if (previous) await previous.promise.catch(() => {});
  if (version !== renderGeneration) return;
  loading.value = true;
  try {
    const page = await pdf.getPage(currentPage.value);
    if (version !== renderGeneration) return;
    const base = page.getViewport({ scale: 1 });
    const width = Math.max(240, container.value.clientWidth - 28);
    const viewport = page.getViewport({ scale: width / base.width });
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const target = canvas.value;
    target.width = Math.floor(viewport.width * ratio);
    target.height = Math.floor(viewport.height * ratio);
    target.style.width = `${viewport.width}px`;
    target.style.height = `${viewport.height}px`;
    renderTask = page.render({
      canvas: target,
      viewport,
      transform: [ratio, 0, 0, ratio, 0, 0],
    });
    await renderTask.promise;
    if (version !== renderGeneration) return;
    loading.value = false;
    await nextTick();
    if (highlight.value && container.value)
      container.value.scrollTop = Math.max(
        0,
        highlight.value.offsetTop +
          (pageElement.value?.offsetTop || 0) -
          container.value.clientHeight * 0.35,
      );
    else if (container.value) container.value.scrollTop = 0;
  } catch (e) {
    if (
      version !== renderGeneration ||
      (e as Error).name === "RenderingCancelledException"
    )
      return;
    error.value =
      "This PDF could not be displayed. Try opening the original file.";
    loading.value = false;
  }
}
async function load() {
  const version = ++generation;
  ++renderGeneration;
  renderTask?.cancel();
  await task?.destroy();
  pdf = null;
  pageCount.value = 0;
  loading.value = true;
  error.value = "";
  try {
    const pdfjs = await import("pdfjs-dist");
    if (version !== generation) return;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    task = pdfjs.getDocument({
      url: props.url,
      useSystemFonts: true,
    });
    const loadingTask = task;
    const document = await loadingTask.promise;
    if (version !== generation) {
      await loadingTask.destroy();
      return;
    }
    pdf = document;
    pageCount.value = document.numPages;
    currentPage.value = Math.max(1, Math.min(props.page, pageCount.value));
    await nextTick();
    await render();
  } catch {
    if (version !== generation) return;
    loading.value = false;
    error.value =
      "This PDF could not be displayed. Try opening the original file.";
  }
}
function navigate(delta: number) {
  currentPage.value = Math.max(
    1,
    Math.min(pageCount.value, currentPage.value + delta),
  );
  render();
}
watch(() => props.url, load);
watch(
  () => [props.page, props.bbox],
  () => {
    currentPage.value = Math.max(
      1,
      Math.min(props.page, pageCount.value || props.page),
    );
    render();
  },
  { deep: true },
);
onMounted(() => {
  load();
  observer = new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, 100);
  });
  if (container.value) observer.observe(container.value);
});
onBeforeUnmount(() => {
  ++generation;
  ++renderGeneration;
  clearTimeout(resizeTimer);
  observer?.disconnect();
  renderTask?.cancel();
  task?.destroy();
});
</script>
<template>
  <div class="pdf-viewer">
    <div class="pdf-toolbar">
      <span
        >{{ title }} · page {{ currentPage
        }}<span v-if="pageCount"> / {{ pageCount }}</span></span
      >
      <div class="pdf-actions">
        <Button
          variant="outline"
          size="sm"
          aria-label="Previous PDF page"
          :disabled="loading || currentPage <= 1"
          @click="navigate(-1)"
          >←</Button
        ><Button
          variant="outline"
          size="sm"
          aria-label="Next PDF page"
          :disabled="loading || currentPage >= pageCount"
          @click="navigate(1)"
          >→</Button
        >
      </div>
    </div>
    <div v-if="error" class="pdf-error" role="alert">
      {{ error }}
      <a :href="`${url}#page=${currentPage}`" target="_blank" rel="noopener"
        >Open original ↗</a
      >
    </div>
    <div ref="container" class="pdf-scroll" :aria-busy="loading">
      <span v-if="loading" class="pdf-loading" role="status">Loading PDF…</span>
      <div
        ref="pageElement"
        class="pdf-page"
        :style="{ visibility: loading ? 'hidden' : 'visible' }"
      >
        <canvas
          ref="canvas"
          :aria-label="`${title}, page ${currentPage}`"
          role="img"
        />
        <div
          v-if="validBox"
          ref="highlight"
          class="pdf-highlight"
          aria-label="Highlighted source passage"
          :style="{
            left: `${validBox[0] * 100}%`,
            top: `${validBox[1] * 100}%`,
            width: `${(validBox[2] - validBox[0]) * 100}%`,
            height: `${(validBox[3] - validBox[1]) * 100}%`,
          }"
        />
      </div>
    </div>
    <div v-if="bbox === null" class="pdf-anchor-note">
      Page preview · no exact section anchor provided.
    </div>
  </div>
</template>
<style scoped>
.pdf-viewer {
  min-width: 0;
}
.pdf-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 11px;
  color: #738168;
  margin-bottom: 10px;
}
.pdf-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.pdf-scroll {
  position: relative;
  background: #edf0e9;
  border: 1px solid #dce3d5;
  border-radius: 8px;
  max-height: 60vh;
  min-height: 240px;
  overflow: auto;
  padding: 14px;
}
.pdf-page {
  position: relative;
  width: fit-content;
  max-width: 100%;
  margin: 0 auto;
  background: white;
  box-shadow: 0 2px 7px #29391a15;
}
.pdf-page canvas {
  display: block;
  max-width: 100%;
}
.pdf-highlight {
  position: absolute;
  border: 2px solid #b28c39;
  background: #f4cb543f;
  pointer-events: none;
  border-radius: 3px;
  box-shadow: 0 0 0 2px #ffffff80;
}
.pdf-loading {
  position: absolute;
  top: 30px;
  left: 20px;
  font-size: 12px;
  color: #88957e;
}
.pdf-error {
  font-size: 12px;
  padding: 15px;
  background: #fff4ea;
  border-radius: 6px;
  margin-bottom: 10px;
}
.pdf-anchor-note {
  font-size: 10px;
  color: #8d9982;
  margin-top: 8px;
}
</style>
