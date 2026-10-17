import {
  access,
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
const entries = [
  { id: "R01", page_count: 34 },
  { id: "R02", page_count: 22 },
];
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
  "Linked R01 and R02 for local PDF preview. No PDF bytes were copied or analyzed. Local demo links and metadata are Git-ignored.",
);
