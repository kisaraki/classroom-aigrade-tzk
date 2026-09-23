import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { Miniflare } from "miniflare";
import {
  identityLookupHash,
  maskIdentity,
  openIdentity,
  rotateIdentity,
  sealIdentity,
} from "../lib/server/identity.ts";
const key = (version) => ({
  version,
  bytes: crypto.getRandomValues(new Uint8Array(32)),
});

test("identity: randomized authenticated encryption, keyed lookup, masking and student binding", async () => {
  const keys = { encryption: key(1), lookup: [key(1)] };
  const plaintext = "fictional-sensitive-identity";
  const first = await sealIdentity("fictional-a", plaintext, keys);
  const second = await sealIdentity("fictional-a", plaintext, keys);
  assert.notEqual(first.encrypted, second.encrypted);
  assert.deepEqual(first.lookupHashes, second.lookupHashes);
  assert.equal(first.encrypted.includes(plaintext), false);
  assert.equal(
    await openIdentity("fictional-a", first.encrypted, 1, [keys.encryption]),
    plaintext,
  );
  assert.equal(maskIdentity("test1234"), "****1234");
  assert.equal(maskIdentity("abc"), "****");
  assert.notEqual(
    await identityLookupHash(plaintext, key(1)),
    first.lookupHashes[0].hash,
  );
  await assert.rejects(
    openIdentity("fictional-b", first.encrypted, 1, [keys.encryption]),
    /IDENTITY_UNAVAILABLE/,
  );
});

test("identity: rotation retains both lookup versions and requires the old encryption key", async () => {
  const initial = { encryption: key(1), lookup: [key(1)] };
  const target = { encryption: key(2), lookup: [...initial.lookup, key(2)] };
  const sealed = await sealIdentity(
    "fictional-a",
    "fictional-identity",
    initial,
  );
  const rotated = await rotateIdentity(
    "fictional-a",
    sealed,
    [initial.encryption],
    target,
  );
  assert.equal(rotated.encryptionKeyVersion, 2);
  assert.equal(rotated.lookupHashes[0].hash, sealed.lookupHashes[0].hash);
  assert.notEqual(rotated.lookupHashes[0].hash, rotated.lookupHashes[1].hash);
  assert.equal(
    await openIdentity("fictional-a", rotated.encrypted, 2, [
      target.encryption,
    ]),
    "fictional-identity",
  );
  await assert.rejects(
    rotateIdentity("fictional-a", sealed, [], target),
    /IDENTITY_UNAVAILABLE/,
  );
  // Recovery by reinstating the original key, not inventing a replacement or storing plaintext.
  assert.equal(
    await openIdentity("fictional-a", sealed.encrypted, 1, [
      initial.encryption,
    ]),
    "fictional-identity",
  );
});

test("identity: malformed ciphertext, lost/wrong key, tampering and reused keys fail closed", async () => {
  const keys = { encryption: key(1), lookup: [key(1)] };
  const sealed = await sealIdentity("fictional-a", "fictional-secret", keys);
  const tampered = JSON.parse(sealed.encrypted);
  const bytes = Uint8Array.from(atob(tampered.ciphertext), (c) =>
    c.charCodeAt(0),
  );
  bytes[0] ^= 1;
  tampered.ciphertext = btoa(String.fromCharCode(...bytes));
  for (const encrypted of ["invalid-json", "{}", JSON.stringify(tampered)])
    await assert.rejects(
      openIdentity("fictional-a", encrypted, 1, [keys.encryption]),
      (error) => error.message === "IDENTITY_UNAVAILABLE",
    );
  await assert.rejects(
    openIdentity("fictional-a", sealed.encrypted, 1, []),
    /IDENTITY_UNAVAILABLE/,
  );
  await assert.rejects(
    openIdentity("fictional-a", sealed.encrypted, 1, [key(1)]),
    /IDENTITY_UNAVAILABLE/,
  );
  await assert.rejects(
    sealIdentity("fictional-a", "fictional-secret", {
      encryption: keys.encryption,
      lookup: [keys.encryption],
    }),
    /MUST_BE_INDEPENDENT/,
  );
  await assert.rejects(
    sealIdentity("fictional-a", "fictional-secret", { ...keys, lookup: [] }),
    /INVALID_LOOKUP_KEY_RING/,
  );
});

test("identity primitives execute in the Workers Web Crypto runtime", async () => {
  const source = await readFile(
    new URL("../lib/server/identity.ts", import.meta.url),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
  const mf = new Miniflare({
    compatibilityDate: "2026-05-15",
    cf: false,
    modules: [
      {
        type: "ESModule",
        path: "identity-worker.js",
        contents: `import { sealIdentity, openIdentity } from './identity.js'; export default { async fetch() { const key = version => ({version, bytes: crypto.getRandomValues(new Uint8Array(32))}); const keys = {encryption: key(1), lookup: [key(1)]}; const sealed = await sealIdentity('fictional-worker', 'fictional-identity', keys); const opened = await openIdentity('fictional-worker', sealed.encrypted, 1, [keys.encryption]); return Response.json({roundTrip: opened === 'fictional-identity', hashLength: sealed.lookupHashes[0].hash.length}); } };`,
      },
      { type: "ESModule", path: "identity.js", contents: compiled },
    ],
  });
  try {
    assert.deepEqual(
      await (await mf.dispatchFetch("https://identity.test/")).json(),
      { roundTrip: true, hashLength: 64 },
    );
  } finally {
    await mf.dispose();
  }
});
