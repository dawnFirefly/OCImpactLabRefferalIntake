import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const REVIEW_STATUSES = ["new", "in_review", "needs_info", "approved", "denied"] as const;
export const PRIORITIES = ["routine", "urgent"] as const;

/** Coordinator-entered intake details. Everything except the name is optional. */
export type IntakeFields = {
  name: string;
  receivedAt: string;
  source: string;
  contact: string;
  priority: (typeof PRIORITIES)[number];
  reviewer: string;
  notes: string;
  reviewStatus: (typeof REVIEW_STATUSES)[number];
};

/** Stored applicant packet: one applicant, one combined referral PDF. */
export type StoredPacket = IntakeFields & {
  id: string;
  fileName: string;
  size: number;
  uploadedAt: string;
  storage: "local" | "google_drive";
};

type PacketStore = {
  list(): Promise<StoredPacket[]>;
  save(meta: Omit<StoredPacket, "id" | "storage">, bytes: Buffer): Promise<StoredPacket>;
  update(id: string, fields: Partial<IntakeFields>): Promise<StoredPacket | null>;
  read(id: string): Promise<Buffer | null>;
  remove(id: string): Promise<boolean>;
};

const LIMITS: Record<Exclude<keyof IntakeFields, "priority" | "reviewStatus">, number> = {
  name: 120, receivedAt: 40, source: 80, contact: 80, reviewer: 60, notes: 2000,
};

/** Validates intake fields from a form or JSON body. `partial` allows omitted fields (PATCH). */
export function parseIntake(input: Record<string, unknown>, partial: boolean): Partial<IntakeFields> {
  const out: Partial<IntakeFields> = {};
  const text = (key: keyof typeof LIMITS) => {
    if (input[key] === undefined) return;
    const value = String(input[key]).trim();
    if (value.length > LIMITS[key]) {
      throw createError({ statusCode: 400, statusMessage: `${key} is too long (max ${LIMITS[key]} characters).` });
    }
    out[key] = value;
  };
  (Object.keys(LIMITS) as (keyof typeof LIMITS)[]).forEach(text);
  if (!partial || out.name !== undefined) {
    if (!out.name) throw createError({ statusCode: 400, statusMessage: "Enter an applicant name or reference." });
  }
  if (out.receivedAt) {
    const date = new Date(out.receivedAt);
    if (Number.isNaN(date.getTime())) throw createError({ statusCode: 400, statusMessage: "Received time is invalid." });
    out.receivedAt = date.toISOString();
  }
  if (input.priority !== undefined) {
    if (!PRIORITIES.includes(input.priority as never)) throw createError({ statusCode: 400, statusMessage: "Unknown priority." });
    out.priority = input.priority as IntakeFields["priority"];
  }
  if (input.reviewStatus !== undefined) {
    if (!REVIEW_STATUSES.includes(input.reviewStatus as never)) throw createError({ statusCode: 400, statusMessage: "Unknown review status." });
    out.reviewStatus = input.reviewStatus as IntakeFields["reviewStatus"];
  }
  return out;
}

/** Fills defaults for records saved before intake fields existed. */
function normalize(packet: Partial<StoredPacket> & { id: string }): StoredPacket {
  return {
    name: "", fileName: "", size: 0, uploadedAt: "", storage: "local",
    source: "", contact: "", reviewer: "", notes: "", priority: "routine",
    ...packet,
    // Statuses that no longer exist (e.g. the removed "completed") fall back to Open.
    reviewStatus: REVIEW_STATUSES.includes(packet.reviewStatus as never) ? packet.reviewStatus : "new",
    receivedAt: packet.receivedAt || packet.uploadedAt || "",
  } as StoredPacket;
}

export const MAX_PACKET_BYTES = 50 * 1024 * 1024;

/** Local disk store in `frontend/.data/referrals` (Git-ignored). */
function localStore(): PacketStore {
  const root = resolve(process.cwd(), ".data/referrals");
  const files = join(root, "files");
  const indexPath = join(root, "index.json");
  const safeId = (id: string) => /^[0-9a-f-]{36}$/.test(id);
  async function load(): Promise<StoredPacket[]> {
    try {
      return (JSON.parse(await readFile(indexPath, "utf8")) as StoredPacket[]).map(normalize);
    } catch {
      return [];
    }
  }
  async function persist(entries: StoredPacket[]) {
    await mkdir(root, { recursive: true });
    await writeFile(indexPath, JSON.stringify(entries, null, 2));
  }
  return {
    list: load,
    async save(meta, bytes) {
      const packet: StoredPacket = { ...meta, id: randomUUID(), storage: "local" };
      await mkdir(files, { recursive: true });
      await writeFile(join(files, `${packet.id}.pdf`), bytes);
      await persist([...(await load()), packet]);
      return packet;
    },
    async update(id, fields) {
      const entries = await load();
      const index = entries.findIndex((e) => e.id === id);
      if (index === -1) return null;
      entries[index] = { ...entries[index]!, ...fields };
      await persist(entries);
      return entries[index]!;
    },
    async read(id) {
      if (!safeId(id)) return null;
      try {
        return await readFile(join(files, `${id}.pdf`));
      } catch {
        return null;
      }
    },
    async remove(id) {
      if (!safeId(id)) return false;
      const entries = await load();
      if (!entries.some((e) => e.id === id)) return false;
      await rm(join(files, `${id}.pdf`), { force: true });
      await persist(entries.filter((e) => e.id !== id));
      return true;
    },
  };
}

type DriveConfig = { clientId: string; clientSecret: string; refreshToken: string; folderId: string };

/** Google Drive store: files live in one folder, applicant metadata in appProperties. */
function driveStore(config: DriveConfig): PacketStore {
  const api = "https://www.googleapis.com/drive/v3/files";
  let token: { value: string; expires: number } | null = null;
  async function accessToken() {
    if (token && token.expires > Date.now() + 60_000) return token.value;
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: config.refreshToken,
      }),
    });
    if (!res.ok) throw new Error(`Google token refresh failed (${res.status}).`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    token = { value: body.access_token, expires: Date.now() + body.expires_in * 1000 };
    return token.value;
  }
  async function drive(url: string, init: RequestInit = {}) {
    const res = await fetch(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${await accessToken()}` },
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Google Drive request failed (${res.status}): ${await res.text()}`);
    }
    return res;
  }
  type DriveFile = { id: string; name: string; size?: string; createdTime: string; description?: string; appProperties?: Record<string, string> };
  const toPacket = (f: DriveFile): StoredPacket => {
    const p = f.appProperties || {};
    return normalize({
      id: f.id,
      name: p.applicantName || f.name,
      fileName: p.originalFileName || f.name,
      size: Number(f.size || 0),
      uploadedAt: p.uploadedAt || f.createdTime,
      storage: "google_drive",
      receivedAt: p.receivedAt,
      source: p.source,
      contact: p.contact,
      reviewer: p.reviewer,
      priority: p.priority as StoredPacket["priority"],
      reviewStatus: p.reviewStatus as StoredPacket["reviewStatus"],
      notes: f.description,
    });
  };
  // Drive limits each appProperty key+value to 124 bytes; notes go in the file description.
  const props = (f: Partial<IntakeFields>) => {
    const out: Record<string, string> = {};
    const set = (key: string, value: string | undefined) => {
      if (value !== undefined) out[key] = Buffer.from(value).subarray(0, 124 - key.length).toString();
    };
    set("applicantName", f.name);
    set("receivedAt", f.receivedAt);
    set("source", f.source);
    set("contact", f.contact);
    set("reviewer", f.reviewer);
    set("priority", f.priority);
    set("reviewStatus", f.reviewStatus);
    return out;
  };
  const fields = "id,name,size,createdTime,description,appProperties";
  const safeId = (id: string) => /^[\w-]{10,}$/.test(id);
  return {
    async list() {
      const q = `'${config.folderId}' in parents and trashed = false and appProperties has { key='referralReady' and value='1' }`;
      const params = new URLSearchParams({
        q, fields: `files(${fields})`, orderBy: "createdTime", pageSize: "1000",
        supportsAllDrives: "true", includeItemsFromAllDrives: "true",
      });
      const res = await drive(`${api}?${params}`);
      return ((await res.json()) as { files: DriveFile[] }).files.map(toPacket);
    },
    async save(meta, bytes) {
      const boundary = `referralready-${randomUUID()}`;
      const metadata = {
        name: `${meta.uploadedAt.slice(0, 10)} ${meta.name} - ${meta.fileName}`,
        mimeType: "application/pdf",
        parents: [config.folderId],
        description: meta.notes,
        appProperties: {
          ...props(meta),
          referralReady: "1",
          originalFileName: meta.fileName.slice(0, 100),
          uploadedAt: meta.uploadedAt,
        },
      };
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`),
        bytes,
        Buffer.from(`\r\n--${boundary}--`),
      ]);
      const res = await drive(
        `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=${fields}`,
        { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body },
      );
      return toPacket((await res.json()) as DriveFile);
    },
    async update(id, f) {
      if (!safeId(id)) return null;
      const body: Record<string, unknown> = { appProperties: props(f) };
      if (f.notes !== undefined) body.description = f.notes;
      const res = await drive(`${api}/${id}?supportsAllDrives=true&fields=${fields}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return res.ok ? toPacket((await res.json()) as DriveFile) : null;
    },
    async read(id) {
      if (!safeId(id)) return null;
      const res = await drive(`${api}/${id}?alt=media&supportsAllDrives=true`);
      return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
    },
    async remove(id) {
      if (!safeId(id)) return false;
      // Move to Drive trash rather than permanently deleting the referral.
      const res = await drive(`${api}/${id}?supportsAllDrives=true`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trashed: true }),
      });
      return res.ok;
    },
  };
}

let store: PacketStore | null = null;
export function usePacketStore(): PacketStore {
  if (store) return store;
  const config = useRuntimeConfig().googleDrive as DriveConfig;
  const driveReady = config.clientId && config.clientSecret && config.refreshToken && config.folderId;
  store = driveReady ? driveStore(config) : localStore();
  return store;
}
