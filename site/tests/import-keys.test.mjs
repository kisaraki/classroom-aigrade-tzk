import assert from "node:assert/strict";
import { test } from "node:test";
import { importIdentityKeys } from "../lib/server/imports/keys.ts";
test("Phase 6 secret key ring: separate keys, explicit versions, malformed values never echoed", () => {
  const key = (n) => ({
    version: n,
    base64: btoa(
      String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
    ),
  });
  const encryption = key(1),
    old = key(1),
    current = key(2);
  assert.equal(
    importIdentityKeys(
      JSON.stringify(encryption),
      JSON.stringify([old, current]),
    ).lookup.length,
    2,
  );
  for (const [a, b] of [
    ["sensitive-invalid", "[]"],
    [JSON.stringify(encryption), JSON.stringify([encryption])],
    [JSON.stringify(encryption), JSON.stringify([old, old])],
    [undefined, undefined],
  ])
    assert.throws(
      () => importIdentityKeys(a, b),
      (error) =>
        error.code === "IDENTITY_KEYS_NOT_CONFIGURED" &&
        !error.message.includes("sensitive-invalid"),
    );
});
