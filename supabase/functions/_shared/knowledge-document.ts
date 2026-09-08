import { extractText } from "npm:unpdf@1.4.0";
import { read, utils } from "./spreadsheet.ts";

export async function extractKnowledgeDocument(
  bytes: Uint8Array,
  mimeType: string,
): Promise<string> {
  if (bytes.byteLength > 10 * 1024 * 1024) throw new Error("Document exceeds extraction limit");
  let content: string;
  if (mimeType === "application/pdf") {
    const extracted = await extractText(bytes, { mergePages: false });
    content = extracted.text.map((text, i) => `[Page ${i + 1}]\n${text}`).join("\n\n");
    if (!extracted.text.some((text) => text.trim().length >= 20))
      throw new Error(
        "No readable PDF text. Provide a searchable PDF or a reviewed text transcription before indexing.",
      );
  } else if (
    mimeType.includes("spreadsheet") ||
    mimeType === "text/csv" ||
    mimeType === "application/vnd.ms-excel"
  ) {
    const workbook = read(bytes, { type: "array" });
    content = workbook.SheetNames.map(
      (name) => `[Sheet: ${name}]\n${utils.sheet_to_csv(workbook.Sheets[name])}`,
    ).join("\n\n");
  } else if (mimeType === "text/plain") content = new TextDecoder().decode(bytes);
  else throw new Error("Use a searchable PDF, spreadsheet, CSV or text version of this document");
  content = content.trim();
  if (!content || content.length > 250000)
    throw new Error(
      "Extraction is empty or exceeds 250,000 characters; split and review the source",
    );
  return content;
}
