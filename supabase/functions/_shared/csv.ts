/** RFC 4180 records: quoted fields may contain commas, escaped quotes and newlines. */
export function parseCsv(input: string): { headers: string[]; rows: string[][] } {
  const text = input.replace(/^\uFEFF/, "");
  const records: string[][] = [];
  let row: string[] = [], cell = "", quoted = false, closed = false;
  const field = () => { row.push(cell); cell = ""; closed = false; };
  const record = () => { field(); if (row.some((v) => v.trim())) records.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else { quoted = false; closed = true; }
      } else cell += ch;
    } else if (ch === ",") field();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      record();
    } else if (ch === '"' && cell === "" && !closed) quoted = true;
    else if (closed || ch === '"') throw new Error("Malformed CSV quoting");
    else cell += ch;
  }
  if (quoted) throw new Error("Unterminated CSV quoted field");
  if (cell || row.length || closed) record();
  const headers = records.shift() ?? [];
  if (records.some((r) => r.length !== headers.length)) throw new Error("CSV row width differs from header");
  return { headers, rows: records };
}

/** Spreadsheet-safe export; neutralize formulas before CSV escaping. */
export function csvCell(value: string): string {
  const safe = /^[\s]*[=+@-]/.test(value) ? "'" + value : value;
  return '"' + safe.replace(/"/g, '""') + '"';
}
