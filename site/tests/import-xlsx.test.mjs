import assert from "node:assert/strict";
import { test } from "node:test";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { createWorkbook, parseXlsx } from "../lib/domain/import-xlsx.ts";
const original = () =>
  createWorkbook([
    {
      name: "國文",
      rows: [
        ["學號", "姓名", "分數"],
        ["00123", "虛構學生", "0"],
      ],
    },
  ]);
const edit = (name, transform) => {
  const files = unzipSync(original());
  files[name] = strToU8(transform(strFromU8(files[name] ?? new Uint8Array())));
  return zipSync(files);
};
test("Phase 6 XLSX: text templates roundtrip without identifier coercion", () => {
  assert.deepEqual(parseXlsx(original()), [
    {
      name: "國文",
      rows: [
        ["學號", "姓名", "分數"],
        ["00123", "虛構學生", "0"],
      ],
    },
  ]);
});
test("Phase 6 XLSX: reject formulas, external relationships, macros and entities", () => {
  for (const bytes of [
    edit("xl/worksheets/sheet1.xml", (text) =>
      text.replace(
        '<is><t xml:space="preserve">0</t></is>',
        "<f>1+1</f><v>2</v>",
      ),
    ),
    edit("xl/_rels/workbook.xml.rels", (text) =>
      text.replace(
        'Target="worksheets/sheet1.xml"',
        'TargetMode="External" Target="https://example.test/private"',
      ),
    ),
    edit("xl/vbaProject.bin", () => "fictional"),
    edit("xl/workbook.xml", (text) =>
      text.replace(
        "<workbook",
        '<!DOCTYPE a [<!ENTITY bomb "test">]><workbook',
      ),
    ),
  ])
    assert.throws(
      () => parseXlsx(bytes),
      (error) =>
        ["UNSUPPORTED_XLSX_CONTENT", "IMPORT_FORMULA_NOT_ALLOWED"].includes(
          error.code,
        ),
    );
});
test("Phase 6 XLSX: expansion, ZIP entries, column and sheet limits reject the whole file", () => {
  assert.throws(
    () => parseXlsx(zipSync({ "large.xml": new Uint8Array(26 * 1024 * 1024) })),
    (error) => error.code === "IMPORT_EXPANSION_LIMIT",
  );
  assert.throws(
    () =>
      parseXlsx(
        zipSync(
          Object.fromEntries(
            Array.from({ length: 1001 }, (_, i) => [
              `${i}.xml`,
              new Uint8Array(),
            ]),
          ),
        ),
      ),
    (error) => error.code === "IMPORT_TOO_MANY_ZIP_ENTRIES",
  );
  assert.throws(
    () =>
      parseXlsx(
        edit("xl/worksheets/sheet1.xml", (text) =>
          text.replace('r="C2"', 'r="AE2"'),
        ),
      ),
    (error) => error.code === "IMPORT_TOO_MANY_COLUMNS",
  );
  assert.throws(
    () => parseXlsx(new Uint8Array([1, 2, 3])),
    (error) => error.code === "INVALID_XLSX",
  );
});

test("Phase 6 XLSX: forged central sizes cannot bypass actual streamed expansion checks", () => {
  const bytes = zipSync({ "large.xml": strToU8("x".repeat(100000)) });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < bytes.length - 46; i++)
    if (view.getUint32(i, true) === 0x02014b50) {
      view.setUint32(i + 24, 1, true);
      break;
    }
  assert.throws(
    () => parseXlsx(bytes),
    (error) => error.code === "IMPORT_EXPANSION_LIMIT",
  );
});

test("Phase 6 XLSX: shared strings and numeric cell text preserve source representation", () => {
  const files = unzipSync(original());
  files["xl/sharedStrings.xml"] = strToU8(
    '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>00123</t></si></sst>',
  );
  files["xl/worksheets/sheet1.xml"] = strToU8(
    strFromU8(files["xl/worksheets/sheet1.xml"])
      .replace(
        '<c r="A2" t="inlineStr"><is><t xml:space="preserve">00123</t></is></c>',
        '<c r="A2" t="s"><v>0</v></c>',
      )
      .replace(
        '<c r="C2" t="inlineStr"><is><t xml:space="preserve">0</t></is></c>',
        '<c r="C2"><v>80.25</v></c>',
      ),
  );
  assert.deepEqual(parseXlsx(zipSync(files))[0].rows[1], [
    "00123",
    "虛構學生",
    "80.25",
  ]);
});

test("Phase 6 XLSX: data rows count across sheets and declared worksheet count is bounded", () => {
  const rows = Array.from({ length: 2501 }, () => ["text"]);
  assert.equal(
    parseXlsx(
      createWorkbook([
        { name: "one", rows },
        { name: "two", rows },
      ]),
    ).length,
    2,
  );
  assert.throws(
    () =>
      parseXlsx(
        createWorkbook([
          { name: "one", rows },
          { name: "two", rows: [...rows, ["extra"]] },
        ]),
      ),
    (error) => error.code === "IMPORT_TOO_MANY_ROWS",
  );
  assert.throws(
    () =>
      parseXlsx(
        edit("xl/workbook.xml", (text) =>
          text.replace(
            "</sheets>",
            '<sheet name="extra" sheetId="2" r:id="rId1"/>'.repeat(10) +
              "</sheets>",
          ),
        ),
      ),
    (error) => error.code === "IMPORT_TOO_MANY_SHEETS",
  );
});
