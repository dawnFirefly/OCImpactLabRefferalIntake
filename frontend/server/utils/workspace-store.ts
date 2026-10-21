import { mkdir, readFile, rename, writeFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { createError, type H3Event } from "h3";
import type { Referral } from "../../app/types";
import type { Workspace } from "../../shared/workspace";

export interface WorkspaceBucket {
  get(key: string): Promise<{ text(): Promise<string>; etag: string } | null>;
  put(key: string, value: string, options: { httpMetadata: { contentType: string }; onlyIf: { etagMatches?: string; etagDoesNotMatch?: string } }): Promise<unknown | null>;
  delete(key: string): Promise<void>;
  list(options: { prefix: string; cursor?: string }): Promise<{ objects: { key: string }[]; truncated: boolean; cursor?: string }>;
}
const conflict = () => createError({ statusCode: 409, statusMessage: "This review changed in another tab. Reload the applicant before saving; your unsaved changes remain in this tab." });
// Serialize local workspace operations; R2 uses storage-level conditional writes across isolates.
const locks = new Map<string, Promise<unknown>>();
export function localExclusive<T>(key: string, action: () => Promise<T>): Promise<T> {
  const pending = locks.get(key) || Promise.resolve();
  const job = pending.catch(() => {}).then(action);
  locks.set(key, job);
  void job.finally(() => { if (locks.get(key) === job) locks.delete(key); }).catch(() => {});
  return job;
}
export function workspaceStore(bucket?: WorkspaceBucket, root = resolve(process.cwd(), ".data/referrals/workspaces")) {
  const key = (id: string) => {
    if (!/^[a-zA-Z0-9_-]{10,120}$/.test(id)) throw createError({ statusCode: 400, statusMessage: "Invalid applicant ID." });
    return `workspaces/${id}.json`;
  };
  async function read(id: string): Promise<{ value: Workspace; etag: string } | null> {
    const objectKey = key(id);
    if (bucket) {
      const object = await bucket.get(objectKey);
      if (!object) return null;
      const value = JSON.parse(await object.text());
      if (value.deleted) throw createError({ statusCode: 404, statusMessage: "Applicant deleted." });
      return { value, etag: object.etag };
    }
    try {
      const value = JSON.parse(await readFile(join(root, `${id}.json`), "utf8")) as Workspace;
      if ((value as Workspace & { deleted?: boolean }).deleted) throw createError({ statusCode: 404, statusMessage: "Applicant deleted." });
      return { value, etag: String(value.revision) };
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }
  async function write(id: string, referral: Referral, expected: number): Promise<Workspace> {
    const action = async () => {
      const previous = await read(id);
      if ((previous?.value.revision || 0) !== expected) throw conflict();
      const value: Workspace = { schemaVersion: 1, revision: expected + 1, updatedAt: new Date().toISOString(), referral };
      const serialized = JSON.stringify(value);
      if (bucket) {
        const saved = await bucket.put(key(id), serialized, { httpMetadata: { contentType: "application/json" },
          onlyIf: previous ? { etagMatches: previous.etag } : { etagDoesNotMatch: "*" } });
        if (!saved) throw conflict();
      } else {
        await mkdir(root, { recursive: true });
        const temp = join(root, `${id}.${randomUUID()}.tmp`);
        await writeFile(temp, serialized);
        await rename(temp, join(root, `${id}.json`));
      }
      return value;
    };
    return bucket ? action() : localExclusive(join(root, id), action);
  }
  async function remove(id: string) {
    const action = async () => {
      const previous = await read(id);
      const tombstone = JSON.stringify({ deleted: true, revision: (previous?.value.revision || 0) + 1 });
      if (bucket) {
        const removed = await bucket.put(key(id), tombstone, { httpMetadata: { contentType: "application/json" }, onlyIf: previous ? { etagMatches: previous.etag } : { etagDoesNotMatch: "*" } });
        if (!removed) throw conflict();
        let cursor: string | undefined;
        do {
          const page = await bucket.list({ prefix: `workspace-history/${id}/`, cursor });
          await Promise.all(page.objects.map(o => bucket.delete(o.key)));
          cursor = page.truncated ? page.cursor : undefined;
        } while (cursor);
      } else {
        key(id);
        await mkdir(root, { recursive: true });
        await writeFile(join(root, `${id}.json`), tombstone);
        await rm(join(root, "history", id), { recursive: true, force: true });
      }
    };
    return bucket ? action() : localExclusive(join(root, id), action);
  }
  return { read, write, remove };
}
export function useWorkspaceStore(event: H3Event) {
  const bucket = event.context.cloudflare?.env?.REFERRAL_PACKETS as WorkspaceBucket | undefined;
  if (event.context.cloudflare && !bucket) throw createError({ statusCode: 503, statusMessage: "Applicant storage is not configured." });
  return workspaceStore(bucket);
}
