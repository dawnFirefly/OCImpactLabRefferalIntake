import type { Evidence, PacketDocument } from "../types";

export const DEMO_PAGE_WIDTH = 600;
export const DEMO_PAGE_HEIGHT = 800;
export const demoRowTop = (index: number) => 232 + index * 48;

/** Generate fictional, readable PDFs from the UI fixtures, not from patient packets. */
export function createDemoPdf(
  document: PacketDocument,
  evidence: Evidence[],
): Blob {
  const escape = (text: string) =>
    text
      .replace(/°/g, "deg ")
      .replace(/×/g, "x")
      .replace(/³/g, "^3")
      .replace(/µ/g, "u")
      .replace(/[^\x20-\x7e]/g, "")
      .replace(/([\\()])/g, "\\$1");
  const text = (value: string, x: number, top: number, size = 12) =>
    `BT /F1 ${size} Tf ${x} ${DEMO_PAGE_HEIGHT - top} Td (${escape(value)}) Tj ET\n`;
  const pageCount = document.page_count || 1;
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${pageCount} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (let page = 1; page <= pageCount; page++) {
    let content = "0.2 0.27 0.21 rg\n";
    content += text("REFERRALREADY / SYNTHETIC DEMONSTRATION", 48, 55, 10);
    content += text(document.name.replace(".pdf", ""), 48, 96, 24);
    content += text("Fictional example - not a patient record", 48, 125, 11);
    content += "0.83 0.87 0.8 RG 48 650 m 552 650 l S\n";
    content += text("Patient: Jane Doe", 48, 181, 13);
    const rows = evidence.filter(
      (e) => e.document_id === document.id && e.page === page,
    );
    rows.forEach((e, i) => {
      const top = demoRowTop(i);
      content += text(e.quote, 55, top, 13);
      content += `0.91 0.93 0.89 RG 48 ${DEMO_PAGE_HEIGHT - top - 18} m 552 ${DEMO_PAGE_HEIGHT - top - 18} l S\n`;
    });
    if (!rows.length)
      content += text(
        "No additional information on this demonstration page.",
        48,
        232,
      );
    content += text(
      `Page ${page} of ${pageCount} / Example information only`,
      48,
      752,
      10,
    );
    const pageId = 4 + (page - 1) * 2;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${DEMO_PAGE_WIDTH} ${DEMO_PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`,
    );
    objects.push(
      `<< /Length ${content.length} >>\nstream\n${content}endstream`,
    );
  }
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([pdf], { type: "application/pdf" });
}
