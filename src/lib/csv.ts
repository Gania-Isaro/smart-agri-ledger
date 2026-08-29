/**
 * CSV import/export.
 *
 * Deliberately dependency-free so the app keeps working with no network and no
 * bundle bloat. Excel opens these files directly; the BOM is what stops Excel
 * from mangling names like Nyirahabimana when it guesses the encoding wrong.
 */

export type Cell = string | number | null | undefined;

export interface Column<T> {
  key: string;
  header: string;
  value: (row: T) => Cell;
}

function escape(value: Cell): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  // A leading =, +, - or @ is treated as a formula by Excel; prefix it so an
  // imported name can never execute as one.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCSV<T>(rows: T[], columns: Column<T>[]): string {
  const head = columns.map((c) => escape(c.header)).join(',');
  const body = rows.map((row) => columns.map((c) => escape(c.value(row))).join(','));
  return ['﻿' + head, ...body].join('\r\n');
}

export function download(filename: string, content: string, mime = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function exportCSV<T>(filename: string, rows: T[], columns: Column<T>[]): void {
  download(filename, toCSV(rows, columns));
}

/* ---------------------------------------------------------------- import */

export interface ParsedCSV {
  headers: string[];
  rows: Record<string, string>[];
}

/** A small RFC-4180 parser: handles quoted fields, embedded commas and newlines. */
export function parseCSV(text: string): ParsedCSV {
  const input = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ''));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };

  const headers = nonEmpty[0]!.map((h) => h.trim());
  const out = nonEmpty.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = (r[i] ?? '').trim();
    });
    return obj;
  });
  return { headers, rows: out };
}

export function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsText(file);
  });
}

export function readFileDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

/**
 * PDF export without a PDF library: render the report into a clean window and
 * hand it to the browser print dialog, where "Save as PDF" is one click. It
 * works offline, which a hosted converter would not.
 */
export function printHTML(title: string, bodyHTML: string): void {
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) {
    alert('Allow pop-ups for this app to export a PDF.');
    return;
  }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
  *{box-sizing:border-box}
  body{font:13px/1.5 "Segoe UI",system-ui,sans-serif;color:#14231a;margin:32px;background:#fff}
  h1{font-size:20px;margin:0 0 4px}
  .meta{color:#5d6b60;font-size:12px;margin-bottom:20px}
  table{width:100%;border-collapse:collapse;margin-top:12px}
  th,td{padding:7px 10px;text-align:left;border-bottom:1px solid #dfe6e0;font-size:12px}
  th{background:#f2f0e6;font-weight:600;text-transform:uppercase;letter-spacing:.04em;font-size:10px;color:#4a5a4e}
  td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
  tfoot td{font-weight:700;border-top:2px solid #1b5e3f;background:#f7f6ef}
  .cards{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}
  .card{border:1px solid #dfe6e0;border-radius:8px;padding:10px 14px;min-width:150px}
  .card b{display:block;font-size:17px;margin-top:2px}
  .card span{font-size:11px;color:#5d6b60;text-transform:uppercase;letter-spacing:.04em}
  @page{margin:16mm}
</style></head><body>${bodyHTML}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}
