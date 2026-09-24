import { Unzip, UnzipInflate, zipSync, strToU8 } from "fflate";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { IMPORT_LIMITS, ImportError } from "./import-csv.ts";

export type ImportSheet = { name: string; rows: string[][] };
function fail(code = "INVALID_XLSX"): never {
  throw new ImportError(code);
}
const array = <T>(v: T | T[] | undefined): T[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];
const xml = (bytes: Uint8Array) => {
  let value: string;
  try {
    value = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return fail();
  }
  if (/<!DOCTYPE|<!ENTITY/iu.test(value)) fail("UNSUPPORTED_XLSX_CONTENT");
  if (XMLValidator.validate(value) !== true) fail();
  return new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: false,
    processEntities: true,
  }).parse(value);
};
function crc(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
/** Validate central metadata and actual streamed expansion, not just attacker supplied lengths. */
function unzip(bytes: Uint8Array) {
  if (bytes.length > IMPORT_LIMITS.maxBytes) fail("IMPORT_FILE_TOO_LARGE");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (
      view.getUint32(i, true) === 0x06054b50 &&
      i + 22 + view.getUint16(i + 20, true) === bytes.length
    ) {
      end = i;
      break;
    }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true))
    fail();
  const count = view.getUint16(end + 10, true),
    size = view.getUint32(end + 12, true),
    offset = view.getUint32(end + 16, true);
  if (count > IMPORT_LIMITS.maxZipEntries) fail("IMPORT_TOO_MANY_ZIP_ENTRIES");
  if (
    !count ||
    count !== view.getUint16(end + 8, true) ||
    offset + size !== end
  )
    fail();
  const expected = new Map<string, { size: number; crc: number }>();
  let cursor = offset,
    declared = 0;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50)
      fail();
    const flags = view.getUint16(cursor + 8, true),
      method = view.getUint16(cursor + 10, true),
      length = view.getUint16(cursor + 28, true);
    const next =
      cursor +
      46 +
      length +
      view.getUint16(cursor + 30, true) +
      view.getUint16(cursor + 32, true);
    if (next > end || flags & 1 || ![0, 8].includes(method))
      fail("UNSUPPORTED_XLSX_CONTENT");
    const name = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(cursor + 46, cursor + 46 + length),
    );
    if (
      !name ||
      name.includes("\\") ||
      name.startsWith("/") ||
      name.split("/").some((x) => x === ".." || x === ".") ||
      expected.has(name)
    )
      fail();
    if (/vbaProject|externalLinks|embeddings|activeX/iu.test(name))
      fail("UNSUPPORTED_XLSX_CONTENT");
    const expanded = view.getUint32(cursor + 24, true);
    declared += expanded;
    if (declared > IMPORT_LIMITS.maxExpandedBytes)
      fail("IMPORT_EXPANSION_LIMIT");
    expected.set(name, {
      size: expanded,
      crc: view.getUint32(cursor + 16, true),
    });
    cursor = next;
  }
  if (cursor !== end) fail();
  const files = new Map<string, Uint8Array>(),
    seen = new Set<string>();
  let actual = 0;
  const stream = new Unzip((file) => {
    const entry = expected.get(file.name);
    if (!entry || seen.has(file.name)) fail();
    seen.add(file.name);
    const chunks: Uint8Array[] = [];
    let length = 0;
    file.ondata = (error, data, final) => {
      if (error instanceof ImportError) throw error;
      if (error) fail();
      actual += data.length;
      length += data.length;
      if (actual > IMPORT_LIMITS.maxExpandedBytes || length > entry.size)
        fail("IMPORT_EXPANSION_LIMIT");
      chunks.push(data);
      if (final) {
        if (length !== entry.size) fail();
        const value = new Uint8Array(length);
        let pos = 0;
        for (const chunk of chunks) {
          value.set(chunk, pos);
          pos += chunk.length;
        }
        if (crc(value) !== entry.crc) fail();
        files.set(file.name, value);
      }
    };
    file.start();
  });
  stream.register(UnzipInflate);
  for (let i = 0; i < bytes.length; i += 1024)
    stream.push(bytes.subarray(i, i + 1024), i + 1024 >= bytes.length);
  if (files.size !== expected.size) fail();
  return files;
}

export function parseXlsx(bytes: Uint8Array): ImportSheet[] {
  try {
    const files = unzip(bytes);
    const get = (name: string) => {
      const b = files.get(name);
      if (!b) return fail();
      return xml(b);
    };
    const types = get("[Content_Types].xml");
    if (/macroEnabled|vbaProject/iu.test(JSON.stringify(types)))
      fail("UNSUPPORTED_XLSX_CONTENT");
    // Scan every XML part, including unused/hidden worksheets and relationship files.
    for (const [name, bytes] of files)
      if (/\.(?:xml|rels)$/iu.test(name)) {
        const content = xml(bytes);
        if (
          /"(?:f|formula|externalLink|externalReference)"\s*:/u.test(
            JSON.stringify(content),
          )
        )
          fail("IMPORT_FORMULA_NOT_ALLOWED");
        if (
          name.endsWith(".rels") &&
          array(content.Relationships?.Relationship).some(
            (r: unknown) =>
              (r as Record<string, string>)["@_TargetMode"] === "External",
          )
        )
          fail("UNSUPPORTED_XLSX_CONTENT");
      }
    const workbook = get("xl/workbook.xml"),
      relations = get("xl/_rels/workbook.xml.rels");
    const sheets = array<Record<string, string>>(
      workbook.workbook?.sheets?.sheet,
    );
    if (!sheets.length || sheets.length > IMPORT_LIMITS.maxSheets)
      fail("IMPORT_TOO_MANY_SHEETS");
    const rels = array<Record<string, string>>(
      relations.Relationships?.Relationship,
    );
    const text = (node: unknown): string => {
      if (node === undefined || node === null) return "";
      if (typeof node === "string") return node;
      if (typeof node !== "object") return fail();
      const n = node as Record<string, unknown>;
      if (n.t !== undefined) return text(n.t);
      if (n["#text"] !== undefined) return String(n["#text"]);
      return array(n.r).map(text).join("");
    };
    const shared = files.has("xl/sharedStrings.xml")
      ? array(get("xl/sharedStrings.xml").sst?.si).map(text)
      : [];
    const names = new Set<string>(),
      paths = new Set<string>();
    let totalRows = 0;
    return sheets.map((sheet) => {
      const name = sheet["@_name"],
        id = sheet["@_id"];
      if (
        !name ||
        names.has(name) ||
        (sheet["@_state"] && sheet["@_state"] !== "visible")
      )
        fail("UNSUPPORTED_XLSX_CONTENT");
      names.add(name);
      const matches = rels.filter((r) => r["@_Id"] === id);
      if (matches.length !== 1 || !matches[0]["@_Type"]?.endsWith("/worksheet"))
        fail();
      const target = matches[0]["@_Target"];
      const path = target?.startsWith("/xl/")
        ? target.slice(1)
        : `xl/${target}`;
      if (
        !/^xl\/worksheets\/[A-Za-z0-9_.-]+\.xml$/u.test(path) ||
        paths.has(path)
      )
        fail();
      paths.add(path);
      const worksheet = get(path).worksheet;
      if (!worksheet || worksheet.mergeCells) fail("UNSUPPORTED_XLSX_CONTENT");
      const rows: string[][] = [];
      let lastRow = 0;
      for (const row of array<Record<string, unknown>>(
        worksheet.sheetData?.row,
      )) {
        const rowIndex = Number(row["@_r"]);
        if (
          !Number.isSafeInteger(rowIndex) ||
          rowIndex <= lastRow ||
          rowIndex > IMPORT_LIMITS.maxDataRows + 1
        )
          fail("IMPORT_TOO_MANY_ROWS");
        while (rows.length < rowIndex - 1) rows.push([]);
        lastRow = rowIndex;
        const values: string[] = [];
        let lastColumn = 0;
        for (const c of array(
          row.c as
            Record<string, unknown> | Record<string, unknown>[] | undefined,
        )) {
          const reference = /^([A-Z]+)([1-9]\d*)$/u.exec(String(c["@_r"]));
          if (!reference || Number(reference[2]) !== rowIndex) fail();
          const column = [...reference[1]].reduce(
            (v, ch) => v * 26 + ch.charCodeAt(0) - 64,
            0,
          );
          if (column > IMPORT_LIMITS.maxColumns)
            fail("IMPORT_TOO_MANY_COLUMNS");
          if (column <= lastColumn || c.f !== undefined)
            fail("IMPORT_FORMULA_NOT_ALLOWED");
          lastColumn = column;
          while (values.length < column - 1) values.push("");
          const type = c["@_t"];
          if (type === "s") {
            const index = Number(c.v);
            if (
              !Number.isSafeInteger(index) ||
              index < 0 ||
              index >= shared.length
            )
              fail();
            values.push(shared[index]);
          } else if (type === "inlineStr") values.push(text(c.is));
          else if (type === undefined || type === "n" || type === "str")
            values.push(c.v === undefined ? "" : String(c.v));
          else fail("UNSUPPORTED_XLSX_CELL");
        }
        rows.push(values);
      }
      totalRows += Math.max(0, rows.length - 1);
      if (totalRows > IMPORT_LIMITS.maxDataRows) fail("IMPORT_TOO_MANY_ROWS");
      return { name, rows };
    });
  } catch (error) {
    if (error instanceof ImportError) throw error;
    return fail();
  }
}

const escape = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const columnName = (n: number) =>
  n <= 26
    ? String.fromCharCode(64 + n)
    : `A${String.fromCharCode(64 + n - 26)}`;
/** Template cells are explicitly text, so Excel cannot discard identifier leading zeros. */
export function createWorkbook(sheets: ImportSheet[]): Uint8Array {
  if (
    !sheets.length ||
    sheets.length > IMPORT_LIMITS.maxSheets ||
    new Set(sheets.map((s) => s.name)).size !== sheets.length
  )
    fail();
  const files: Record<string, Uint8Array> = {};
  const put = (name: string, value: string) => {
    files[name] = strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${value}`,
    );
  };
  const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const rel =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  put(
    "[Content_Types].xml",
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
  );
  put(
    "_rels/.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  put(
    "xl/workbook.xml",
    `<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets>${sheets.map((s, i) => `<sheet name="${escape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
  );
  put(
    "xl/_rels/workbook.xml.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${rel}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`,
  );
  sheets.forEach((s, i) =>
    put(
      `xl/worksheets/sheet${i + 1}.xml`,
      `<worksheet xmlns="${ns}"><sheetData>${s.rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => `<c r="${columnName(c + 1)}${r + 1}" t="inlineStr"><is><t xml:space="preserve">${escape(v)}</t></is></c>`).join("")}</row>`).join("")}</sheetData></worksheet>`,
    ),
  );
  return zipSync(files, { level: 6 });
}
