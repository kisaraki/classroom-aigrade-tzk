import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCsv } from "../lib/domain/import-csv.ts";

// Deliberately tiny parser-test limits, not approved production upload defaults.
const limits = { maxBytes: 1024, maxDataRows: 5, maxColumns: 4 };
const bytes = (text) => new TextEncoder().encode(text);

test("Phase 6 CSV: UTF-8/BOM, quotes, CRLF and multiline cells preserve exact text", () => {
  assert.deepEqual(
    parseCsv(
      bytes(
        '\ufeff學號,姓名,分數\r\n00123,"虛構,學生",0\r\n00124,"含""引號\r\n換行",80.25\r\n',
      ),
      limits,
    ),
    [
      ["學號", "姓名", "分數"],
      ["00123", "虛構,學生", "0"],
      ["00124", '含"引號\r\n換行', "80.25"],
    ],
  );
  assert.deepEqual(parseCsv(bytes("a,b,c\n , ,\n"), limits), [
    ["a", "b", "c"],
    [" ", " ", ""],
  ]);
  assert.deepEqual(parseCsv(bytes("a,b\n1,\n"), limits), [
    ["a", "b"],
    ["1", ""],
  ]);
  assert.deepEqual(parseCsv(bytes(""), limits), []);
});

test("Phase 6 CSV: malformed quoting and invalid UTF-8 reject without echoing cell contents", () => {
  for (const input of [
    'a\n"private',
    'a\npri"vate',
    'a\n"private"extra',
    "a\nprivate\u0000",
  ]) {
    assert.throws(
      () => parseCsv(bytes(input), limits),
      (error) =>
        error.code === "INVALID_CSV" && !error.message.includes("private"),
    );
  }
  assert.throws(
    () => parseCsv(new Uint8Array([0xc3, 0x28]), limits),
    (error) => error.code === "INVALID_CSV_ENCODING",
  );
});

test("Phase 6 CSV: caller-supplied byte/row/column limits apply at exact boundaries", () => {
  const tiny = { maxBytes: 7, maxDataRows: 1, maxColumns: 2 };
  assert.deepEqual(parseCsv(bytes("a,b\n1,2"), tiny), [
    ["a", "b"],
    ["1", "2"],
  ]);
  assert.throws(
    () => parseCsv(bytes("a,b\n1,22"), tiny),
    (error) => error.code === "IMPORT_FILE_TOO_LARGE",
  );
  assert.throws(
    () => parseCsv(bytes("a\n1\n2"), tiny),
    (error) => error.code === "IMPORT_TOO_MANY_ROWS",
  );
  assert.throws(
    () => parseCsv(bytes("a,b,c"), tiny),
    (error) => error.code === "IMPORT_TOO_MANY_COLUMNS",
  );
  assert.throws(
    () => parseCsv(bytes("字"), { ...tiny, maxBytes: 2 }),
    (error) => error.code === "IMPORT_FILE_TOO_LARGE",
  );
  assert.throws(
    () => parseCsv(bytes("a"), { ...tiny, maxDataRows: 0 }),
    (error) => error.code === "INVALID_IMPORT_LIMITS",
  );
});
