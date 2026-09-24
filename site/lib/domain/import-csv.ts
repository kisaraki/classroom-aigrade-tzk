export class ImportError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
    this.name = "ImportError";
  }
}
export type CsvLimits = {
  maxBytes: number;
  maxDataRows: number;
  maxColumns: number;
};
export const IMPORT_LIMITS = {
  maxBytes: 5 * 1024 * 1024,
  maxDataRows: 5000,
  maxColumns: 30,
  maxSheets: 10,
  maxExpandedBytes: 25 * 1024 * 1024,
  maxZipEntries: 1000,
} as const;

/** CSV is text throughout: identifiers and leading zeros must never be coerced to numbers. */
export function parseCsv(bytes: Uint8Array, limits: CsvLimits): string[][] {
  const fail = (code: string): never => {
    throw new ImportError(code);
  };
  if (
    !limits ||
    ![limits.maxBytes, limits.maxDataRows, limits.maxColumns].every(
      (n) => Number.isSafeInteger(n) && n > 0,
    )
  )
    fail("INVALID_IMPORT_LIMITS");
  if (bytes.byteLength > limits.maxBytes) fail("IMPORT_FILE_TOO_LARGE");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return fail("INVALID_CSV_ENCODING");
  }
  if (text.includes("\0")) fail("INVALID_CSV");
  if (!text) return [];
  const rows: string[][] = [];
  let row: string[] = [],
    value = "",
    quoted = false,
    closed = false,
    started = false;
  const cell = () => {
    row.push(value);
    value = "";
    closed = false;
    started = false;
    if (row.length > limits.maxColumns) fail("IMPORT_TOO_MANY_COLUMNS");
  };
  const record = () => {
    cell();
    rows.push(row);
    row = [];
    if (rows.length > limits.maxDataRows + 1) fail("IMPORT_TOO_MANY_ROWS");
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else value += c;
    } else if (c === ",") cell();
    else if (c === "\r" || c === "\n") {
      record();
      if (c === "\r" && text[i + 1] === "\n") i++;
    } else if (c === '"' && !started && !closed) {
      quoted = true;
      started = true;
    } else {
      if (closed || c === '"') fail("INVALID_CSV");
      value += c;
      started = true;
    }
  }
  if (quoted) fail("INVALID_CSV");
  if (started || closed || row.length) record();
  return rows;
}
