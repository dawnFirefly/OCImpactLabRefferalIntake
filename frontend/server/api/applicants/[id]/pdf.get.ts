/** Single `bytes=` range (start-end, start-, or -suffix) resolved against the file size. */
function parseRange(header: string | undefined, size: number) {
  const match = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  return start <= end && start < size ? { start, end } : "unsatisfiable" as const;
}

/**
 * Streams a stored applicant PDF. Supports HTTP range requests so the PDF viewer can show the first
 * pages without downloading the whole packet. The file never changes, so the browser may keep a
 * private copy for a day.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id") || "";
  const store = usePacketStore(event);
  const packet = (await store.list()).find((p) => p.id === id);
  if (!packet) throw createError({ statusCode: 404, statusMessage: "PDF not found." });
  setResponseHeaders(event, {
    "Content-Type": "application/pdf",
    "Content-Disposition": "inline",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=86400",
  });
  const range = parseRange(getHeader(event, "range"), packet.size);
  if (range === "unsatisfiable") {
    setResponseStatus(event, 416);
    setResponseHeader(event, "Content-Range", `bytes */${packet.size}`);
    return "";
  }
  if (range) {
    const length = range.end - range.start + 1;
    const body = await store.readRange(id, range.start, length);
    if (!body) throw createError({ statusCode: 404, statusMessage: "PDF not found." });
    setResponseStatus(event, 206);
    setResponseHeaders(event, { "Content-Range": `bytes ${range.start}-${range.end}/${packet.size}`, "Content-Length": String(length) });
    return body;
  }
  const body = await store.read(id);
  if (!body) throw createError({ statusCode: 404, statusMessage: "PDF not found." });
  setResponseHeader(event, "Content-Length", packet.size);
  return body;
});
