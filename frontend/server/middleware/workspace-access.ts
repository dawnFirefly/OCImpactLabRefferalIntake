import { requireWorkspace } from "../utils/workspace-access";
export default defineEventHandler(async event => {
  if (!getRequestURL(event).pathname.startsWith("/api/")) return;
  setResponseHeader(event, "Cache-Control", "private, no-store");
  await requireWorkspace(event, useRuntimeConfig(event));
});
