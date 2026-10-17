import test from "node:test";
import assert from "node:assert/strict";
import { maxPacketBytes, storePacket, type PacketBucket } from "../server/utils/packet-storage.ts";

const pdf = () => ({ name: "pdf", filename: "fictional-applicant.pdf", data: new TextEncoder().encode("%PDF-1.7\nFictional test bytes\n%%EOF") });

test("R2 stores exact original PDF bytes under a random key without patient names or filename metadata", async () => {
  const file = pdf();
  const writes: unknown[] = [];
  const bucket: PacketBucket = { async put(key, value, options) {
    writes.push({ key, value, options });
    assert.match(key, /^packets\/[0-9a-f-]{36}\.pdf$/);
    assert.deepEqual(value, file.data);
    assert.deepEqual(options, { httpMetadata: { contentType: "application/pdf" } });
    return { key, size: value.length, uploaded: new Date("2026-10-17T00:00:00Z") };
  } };
  const first = await storePacket(bucket, [file]);
  const second = await storePacket(bucket, [file]);
  assert.equal(first.size, file.data.length);
  assert.equal(first.uploaded_at, "2026-10-17T00:00:00.000Z");
  assert.notEqual(first.key, second.key);
  assert.equal(writes.length, 2);
});

test("invalid, empty, multiple or oversized PDFs never reach R2", async () => {
  let writes = 0;
  const bucket: PacketBucket = { async put() { writes++; return null; } };
  for (const parts of [[], [pdf(), pdf()], [{ ...pdf(), name: "other" }], [{ ...pdf(), filename: "image.png" }],
    [{ ...pdf(), data: new Uint8Array() }], [{ ...pdf(), data: new TextEncoder().encode("not a PDF") }]]) {
    await assert.rejects(storePacket(bucket, parts), (error: any) => error.statusCode === 400);
  }
  const oversized = new Uint8Array(maxPacketBytes + 1); oversized.set(pdf().data);
  await assert.rejects(storePacket(bucket, [{ ...pdf(), data: oversized }]), (error: any) => error.statusCode === 413);
  assert.equal(writes, 0);
});

test("the full 50 MB storage boundary is accepted, independently of the inline analysis limit", async () => {
  assert.equal(maxPacketBytes, 50 * 1024 * 1024);
  const data = new Uint8Array(maxPacketBytes); data.set(pdf().data);
  const bucket: PacketBucket = { async put(key, value) {
    return { key, size: value.byteLength, uploaded: new Date("2026-10-17T00:00:00Z") };
  } };
  assert.equal((await storePacket(bucket, [{ ...pdf(), data }])).size, maxPacketBytes);
});

test("R2 errors and unconfirmed writes never leak provider content or show a saved result", async () => {
  for (const bucket of [{ async put() { throw new Error("sensitive provider details"); } }, { async put() { return null; } }]) {
    await assert.rejects(storePacket(bucket, [pdf()]), (error: any) => error.statusCode === 502 && !error.message.includes("sensitive"));
  }
});
