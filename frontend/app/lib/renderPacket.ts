import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { maxVisionPages, maxVisionBody } from "#shared/ai";
/** Render only; text recognition happens at the selected server-side AI provider. */
export async function renderPacket(file: File, signal?: AbortSignal, progress?: (page: number, total: number) => void): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), useSystemFonts: true });
  const cancel = () => { void task.destroy(); };
  signal?.addEventListener("abort", cancel, { once: true });
  let bytes = 0;
  try {
    signal?.throwIfAborted();
    const document = await task.promise;
    if (document.numPages > maxVisionPages) throw new Error(`This provider accepts up to ${maxVisionPages} pages. Use Anthropic for a larger packet.`);
    const images: string[] = [];
    for (let n = 1; n <= document.numPages; n++) {
      signal?.throwIfAborted();
      progress?.(n, document.numPages);
      const page = await document.getPage(n);
      const natural = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: 1600 / Math.max(natural.width, natural.height) });
      const canvas = window.document.createElement("canvas");
      try {
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        await page.render({ canvas, viewport }).promise;
        const image = canvas.toDataURL("image/jpeg", 0.85);
        bytes += image.length;
        if (bytes > maxVisionBody - 65536) throw new Error("Rendered packet exceeds this provider's 24 MB request limit. Use Anthropic or a smaller packet.");
        images.push(image);
      } finally { canvas.width = canvas.height = 0; page.cleanup(); }
    }
    return images;
  } finally { signal?.removeEventListener("abort", cancel); await task.destroy(); }
}
