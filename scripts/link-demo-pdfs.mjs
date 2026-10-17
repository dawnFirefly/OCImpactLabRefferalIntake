import {
  access,
  readdir,
  mkdir,
  lstat,
  readlink,
  symlink,
  writeFile,
} from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const input = process.argv[2];
if (!input) {
  console.error(
    "Usage: node scripts/link-demo-pdfs.mjs /path/to/the/provided/pdf/folder",
  );
  process.exit(1);
}
const source = resolve(input);
const target = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../frontend/public/local-demo",
);
const knownPages = { R01: 34, R02: 22 };
const entries = (await readdir(source))
  .filter(name => /^R\d{2}\.pdf$/.test(name))
  .sort()
  .map(name => ({ id: name.slice(0, -4), page_count: knownPages[name.slice(0, -4)] ?? null }));
if (!entries.length) throw new Error("No R01.pdf-style referral packets found in this folder.");
for (const entry of entries) await access(resolve(source, entry.id + ".pdf"));
await mkdir(target, { recursive: true });
for (const entry of entries) {
  const path = resolve(target, entry.id + ".pdf"),
    original = resolve(source, entry.id + ".pdf");
  const existing = await lstat(path).catch(() => null);
  if (existing) {
    if (!existing.isSymbolicLink() || (await readlink(path)) !== original)
      throw new Error(
        `Already exists: ${path}. Keep or relocate it before linking another folder.`,
      );
  } else await symlink(original, path, "file");
}
await writeFile(
  resolve(target, "manifest.json"),
  JSON.stringify(
    entries.map((entry) => ({
      ...entry,
      name: entry.id + ".pdf",
      url: `/local-demo/${entry.id}.pdf`,
    })),
    null,
    2,
  ),
);
console.log(
  `Linked ${entries.length} separate referral PDFs for local preview. No PDF bytes were copied or analyzed. Links and metadata are Git-ignored.`,
);
