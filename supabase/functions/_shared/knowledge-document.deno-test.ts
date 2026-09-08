import { assert, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractKnowledgeDocument } from "./knowledge-document.ts";

function pdf(text: string) {
  const stream = `BT /F1 12 Tf 72 700 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let document = "%PDF-1.4\n";
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(document.length);
    document += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = document.length;
  document += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(document);
}
Deno.test("PDF knowledge preserves readable text and page references", async () => {
  const content = await extractKnowledgeDocument(
    pdf("PHC approved wayfinding project evidence"),
    "application/pdf",
  );
  assert(content.includes("[Page 1]"));
  assert(content.includes("PHC approved wayfinding project evidence"));
});
Deno.test("Empty PDF and unsupported documents do not become indexed knowledge", async () => {
  await assertRejects(
    () => extractKnowledgeDocument(pdf(""), "application/pdf"),
    Error,
    "No readable PDF text",
  );
  await assertRejects(
    () => extractKnowledgeDocument(new Uint8Array([1]), "image/png"),
    Error,
    "searchable PDF",
  );
});
Deno.test("Arabic text knowledge retains exact source words", async () => {
  const text = "مشروع لوحات إرشادية معتمد للشركة";
  assert((await extractKnowledgeDocument(new TextEncoder().encode(text), "text/plain")) === text);
});
