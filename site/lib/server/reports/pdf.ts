import { strToU8, zlibSync } from "fflate";
import {
  bounded,
  MAX_REPORT_BYTES,
  ReportError,
  validateReportSource,
  type Report,
} from "./formats.ts";
type Font = {
  bytes: Uint8Array;
  glyph: (code: number) => number;
  width: (glyph: number) => number;
};
export function parseFont(bytes: Uint8Array): Font {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    tables: Record<string, number> = {};
  for (let i = 0; i < view.getUint16(4); i++) {
    const p = 12 + i * 16;
    tables[String.fromCharCode(...bytes.slice(p, p + 4))] = view.getUint32(
      p + 8,
    );
  }
  const units = view.getUint16(tables.head + 18),
    metrics = view.getUint16(tables.hhea + 34),
    cmap = tables.cmap;
  let sub = 0;
  for (let i = 0; i < view.getUint16(cmap + 2); i++) {
    const p = cmap + 4 + i * 8,
      offset = cmap + view.getUint32(p + 4);
    if (view.getUint16(offset) === 12) sub = offset;
  }
  if (!sub) throw new ReportError("REPORT_FONT_UNAVAILABLE", 503);
  const count = view.getUint32(sub + 12);
  return {
    bytes,
    glyph(code) {
      let lo = 0,
        hi = count - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1,
          p = sub + 16 + mid * 12,
          start = view.getUint32(p),
          end = view.getUint32(p + 4);
        if (code < start) hi = mid - 1;
        else if (code > end) lo = mid + 1;
        else return view.getUint32(p + 8) + code - start;
      }
      return 0;
    },
    width(glyph) {
      return Math.round(
        (view.getUint16(tables.hmtx + Math.min(glyph, metrics - 1) * 4) *
          1000) /
          units,
      );
    },
  };
}
const join = (parts: Uint8Array[]) => {
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    bytes.set(p, at);
    at += p.length;
  }
  return bytes;
};
const hex = (s: string) =>
  [...s]
    .map((c) => {
      const code = c.codePointAt(0)!;
      if (code <= 65535) return code.toString(16).padStart(4, "0");
      const n = code - 65536;
      return (
        (0xd800 + (n >> 10)).toString(16) + (0xdc00 + (n & 1023)).toString(16)
      );
    })
    .join("");
/** Embed the licensed font, explicit glyph map and Unicode map; no links, actions or executable content. */
export function pdf(report: Report, font: Font) {
  validateReportSource(report);
  let objectBytes = 0;
  const objects: Uint8Array[] = [],
    add = (text: string | Uint8Array) => {
      const bytes = typeof text === "string" ? strToU8(text) : text;
      objectBytes += bytes.length;
      if (objectBytes > MAX_REPORT_BYTES)
        throw new ReportError("REPORT_TOO_LARGE", 413);
      objects.push(bytes);
      return objects.length;
    },
    stream = (bytes: Uint8Array, dict = "") =>
      add(
        join([
          strToU8(`<< /Length ${bytes.length} ${dict} >>\nstream\n`),
          bytes,
          strToU8("\nendstream"),
        ]),
      );
  const catalog = add(""),
    pagesObject = add(""),
    cids = new Map<string, number>(),
    glyphs: number[] = [0],
    widths: number[] = [0];
  const encode = (text: string) =>
    [...text]
      .map((c) => {
        let cid = cids.get(c);
        if (cid === undefined) {
          const glyph = font.glyph(c.codePointAt(0)!);
          if (!glyph) throw new ReportError("REPORT_UNSUPPORTED_CHARACTER");
          cid = cids.size + 1;
          if (cid > 65535) throw new ReportError("REPORT_TOO_LARGE", 413);
          cids.set(c, cid);
          glyphs.push(glyph);
          widths.push(font.width(glyph));
        }
        return cid.toString(16).padStart(4, "0");
      })
      .join("");
  const clean = (s: string) =>
    s
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .replace(/\t/g, " ");
  const wrap = (text: string, size = 10) => {
    const lines: string[] = [];
    for (const paragraph of clean(text).split(/\r?\n/)) {
      let line = "",
        width = 0;
      for (const c of paragraph) {
        const w = (font.width(font.glyph(c.codePointAt(0)!)) * size) / 1000;
        if (width + w > 515 && line) {
          lines.push(line);
          line = "";
          width = 0;
        }
        line += c;
        width += w;
      }
      lines.push(line);
    }
    return lines;
  };
  const fontObject = add(""),
    pageIds: number[] = [],
    pageContents: number[] = [];
  let y = 0,
    commands: string[] = [];
  function text(s: string, x: number, at: number, size: number) {
    commands.push(
      `BT /F1 ${size} Tf 1 0 0 1 ${x} ${at} Tm <${encode(s)}> Tj ET`,
    );
  }
  function finishPage() {
    if (commands.length)
      pageContents.push(
        stream(zlibSync(strToU8(commands.join("\n"))), "/Filter /FlateDecode"),
      );
  }
  function page() {
    finishPage();
    commands = [];
    y = 785;
    text(report.title, 40, y, 16);
    y -= 24;
    for (const line of wrap(report.subtitle, 9)) {
      text(line, 40, y, 9);
      y -= 14;
    }
    y -= 12;
  }
  page();
  for (const row of report.rows) {
    const lines = report.columns.flatMap((column, i) =>
      wrap(`${column}：${row[i] === null ? "—" : String(row[i])}`),
    );
    if (y - Math.min(lines.length, 46) * 14 < 60) page();
    commands.push(`0.12 0.33 0.30 RG 40 ${y + 14} m 555 ${y + 14} l S`);
    for (const line of lines) {
      if (y < 60) {
        page();
        const nameIndex = report.columns.indexOf("姓名");
        if (nameIndex >= 0) {
          text(`續：${row[nameIndex]}`, 40, y, 10);
          y -= 20;
        }
      }
      text(line, 40, y, 10);
      y -= 14;
    }
    y -= 16;
  }
  if (!report.rows.length) text("目前沒有資料。", 40, y, 10);
  finishPage();
  pageContents.forEach((content, i) => {
    const footer = `\nBT /F1 9 Tf 1 0 0 1 40 30 Tm <${encode(`限授權用途・第 ${i + 1} / ${pageContents.length} 頁`)}> Tj ET`;
    const footerContent = stream(
      zlibSync(strToU8(footer)),
      "/Filter /FlateDecode",
    );
    pageIds.push(
      add(
        `<< /Type /Page /Parent ${pagesObject} 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 ${fontObject} 0 R >> >> /Contents [${content} 0 R ${footerContent} 0 R] >>`,
      ),
    );
  });
  const file = stream(
      zlibSync(font.bytes),
      `/Filter /FlateDecode /Length1 ${font.bytes.length}`,
    ),
    descriptor = add(
      `<< /Type /FontDescriptor /FontName /NotoSansTC-Regular /Flags 4 /FontBBox [-1000 -1000 3000 3000] /ItalicAngle 0 /Ascent 1160 /Descent -290 /CapHeight 730 /StemV 80 /FontFile2 ${file} 0 R >>`,
    );
  const map = new Uint8Array(glyphs.length * 2);
  glyphs.forEach((g, i) => {
    map[i * 2] = g >> 8;
    map[i * 2 + 1] = g & 255;
  });
  const mapping = stream(zlibSync(map), "/Filter /FlateDecode"),
    descendant = add(
      `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /NotoSansTC-Regular /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptor} 0 R /CIDToGIDMap ${mapping} 0 R /W [0 [${widths.join(" ")}]] >>`,
    );
  const pairs = [...cids].map(
      ([c, cid]) => `<${cid.toString(16).padStart(4, "0")}> <${hex(c)}>`,
    ),
    blocks: string[] = [];
  for (let i = 0; i < pairs.length; i += 100) {
    const block = pairs.slice(i, i + 100);
    blocks.push(`${block.length} beginbfchar\n${block.join("\n")}\nendbfchar`);
  }
  const unicode = stream(
    strToU8(
      `/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /ReportUnicode def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange ${blocks.join("\n")} endcmap CMapName currentdict /CMap defineresource pop end end`,
    ),
  );
  objects[fontObject - 1] = strToU8(
    `<< /Type /Font /Subtype /Type0 /BaseFont /NotoSansTC-Regular /Encoding /Identity-H /DescendantFonts [${descendant} 0 R] /ToUnicode ${unicode} 0 R >>`,
  );
  objects[catalog - 1] = strToU8(
    `<< /Type /Catalog /Pages ${pagesObject} 0 R >>`,
  );
  objects[pagesObject - 1] = strToU8(
    `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`,
  );
  const pieces = [strToU8("%PDF-1.7\n")],
    offsets = [0];
  let offset = pieces[0].length;
  objects.forEach((object, i) => {
    offsets.push(offset);
    const part = join([
      strToU8(`${i + 1} 0 obj\n`),
      object,
      strToU8("\nendobj\n"),
    ]);
    pieces.push(part);
    offset += part.length;
  });
  pieces.push(
    strToU8(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
        .join(
          "",
        )}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${offset}\n%%EOF\n`,
    ),
  );
  return bounded(join(pieces));
}
