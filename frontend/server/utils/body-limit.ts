import { createError, getHeader, type H3Event } from "h3";
export async function assertBodySize(event: H3Event, maximum: number) {
  const value = getHeader(event, "content-length");
  if (!value || !/^\d+$/.test(value) || Number(value) <= 0 || Number(value) > maximum) {
    throw createError({ statusCode: 413, statusMessage: `Request must include a size up to ${Math.floor(maximum / 1024 / 1024)} MB.` });
  }
}
