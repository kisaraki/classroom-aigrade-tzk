import { zipSync, strToU8 } from "fflate";
export type Cell = string | number | null;
export type Report = {
  title: string;
  subtitle: string;
  columns: string[];
  rows: Cell[][];
};
export class ReportError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
export const MAX_REPORT_BYTES = 10 * 1024 * 1024;
export class ReportSourceBudget {
  private used = 0;
  addBytes(bytes: number) {
    if (
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      bytes > MAX_REPORT_BYTES - this.used
    )
      throw new ReportError("REPORT_SOURCE_TOO_LARGE", 413);
    this.used += bytes;
  }
  add(text: string) {
    const encoder = new TextEncoder();
    // Keep each temporary allocation bounded and do not split surrogate pairs.
    for (let at = 0; at < text.length;) {
      let end = Math.min(at + 4096, text.length);
      if (end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1])) end--;
      this.addBytes(encoder.encode(text.slice(at, end)).length);
      at = end;
    }
  }
}
export function validateReportSource(report: Report) {
  const budget = new ReportSourceBudget();
  budget.add(report.title);
  budget.add(report.subtitle);
  for (const value of report.columns) budget.add(value);
  for (const row of report.rows)
    for (const value of row) budget.add(value === null ? "—" : String(value));
}
export function bounded(bytes: Uint8Array) {
  if (bytes.length > MAX_REPORT_BYTES)
    throw new ReportError("REPORT_TOO_LARGE", 413);
  return bytes;
}
export function safeSpreadsheetText(value: string) {
  // Spreadsheet importers may discard leading whitespace/control characters before evaluating formulas.
  return /^[\s\u0000-\u001f\u007f]*[=+\-@＝＋－＠]/u.test(value) ||
    /^[\t\r\n]/u.test(value)
    ? "文字：" + value
    : value;
}
export const xml = (v: string) =>
  v
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
export function csv(report: Report) {
  validateReportSource(report);
  const quote = (v: Cell) =>
    '"' +
    safeSpreadsheetText(v === null ? "—" : String(v)).replace(/"/g, '""') +
    '"';
  return bounded(
    strToU8(
      "\uFEFF" +
        [[report.title], [report.subtitle], report.columns, ...report.rows]
          .map((row) => row.map(quote).join(","))
          .join("\r\n") +
        "\r\n",
    ),
  );
}
export function xlsx(report: Report) {
  validateReportSource(report);
  const column = (n: number): string =>
    n < 26
      ? String.fromCharCode(65 + n)
      : column(Math.floor(n / 26) - 1) + column(n % 26);
  const rows = [
    [report.title],
    [report.subtitle],
    report.columns,
    ...report.rows,
  ]
    .map(
      (row, i) =>
        `<row r="${i + 1}">${row
          .map((v, j) => {
            const address = column(j) + (i + 1);
            if (typeof v === "number" && Number.isFinite(v))
              return `<c r="${address}" s="${i >= 3 && /平均|總分|檢測・|段考・/.test(report.columns[j]) ? 1 : 0}"><v>${v}</v></c>`;
            const text = safeSpreadsheetText(v === null ? "—" : String(v));
            if (text.length > 32767)
              throw new ReportError("REPORT_CELL_TOO_LONG", 413);
            return `<c r="${address}" t="inlineStr"><is><t xml:space="preserve">${xml(text)}</t></is></c>`;
          })
          .join("")}</row>`,
    )
    .join("");
  return bounded(
    zipSync(
      Object.fromEntries(
        Object.entries({
          "[Content_Types].xml":
            '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
          "_rels/.rels":
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
          "xl/workbook.xml":
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="成績報表" sheetId="1" r:id="rId1"/></sheets></workbook>',
          "xl/_rels/workbook.xml.rels":
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
          "xl/styles.xml":
            '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Noto Sans TC"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf fontId="0" fillId="0" borderId="0"/><xf numFmtId="2" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/></cellXfs></styleSheet>',
          "xl/worksheets/sheet1.xml": `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols><col min="1" max="${report.columns.length}" width="18" customWidth="1"/></cols><sheetData>${rows}</sheetData><pageSetup orientation="landscape" paperSize="9"/></worksheet>`,
        }).map(([k, v]) => [k, strToU8(v)]),
      ),
      { level: 6 },
    ),
  );
}
