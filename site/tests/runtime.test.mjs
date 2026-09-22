import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";

test("Phase 0: isolated Workers runtime and storage", async (t) => {
  const hosting = JSON.parse(
    await readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
  );
  assert.equal(hosting.d1, "DB");
  assert.equal(hosting.r2, "FILES");
  const mf = new Miniflare({
    modules: true,
    compatibilityDate: "2026-05-15",
    cf: false,
    d1Databases: [hosting.d1],
    r2Buckets: [hosting.r2],
    bindings: { PHASE0_TEST_SECRET: "synthetic-test-value" },
    script: `export default {
      async fetch(request, env) {
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("synthetic"));
        const row = await env.DB.prepare("SELECT 1 AS ok").first();
        return Response.json({
          database: row.ok,
          secretAvailable: typeof env.PHASE0_TEST_SECRET === "string",
          cryptoBytes: digest.byteLength
        }, {headers: {"Set-Cookie": "phase0_probe=synthetic; HttpOnly; Secure; SameSite=Lax; Path=/"}});
      }
    };`,
  });
  try {
    await t.test(
      "Worker has D1, private binding, Web Crypto and cookie headers",
      async () => {
        const response = await mf.dispatchFetch("https://phase0.test/");
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
          database: 1,
          secretAvailable: true,
          cryptoBytes: 32,
        });
        const cookie = response.headers.get("set-cookie");
        for (const attribute of ["HttpOnly", "Secure", "SameSite=Lax"])
          assert.ok(cookie.includes(attribute));
      },
    );
    await t.test("D1 prepared queries, batch, null and FTS5", async () => {
      const db = await mf.getD1Database(hosting.d1);
      const bound = await db
        .prepare("SELECT ? AS label, NULL AS missing, 0 AS zero")
        .bind("fictional-row")
        .first();
      assert.deepEqual(bound, {
        label: "fictional-row",
        missing: null,
        zero: 0,
      });
      const batch = await db.batch([
        db.prepare("SELECT 1 AS value"),
        db.prepare("SELECT 2 AS value"),
      ]);
      assert.equal(batch[0].results[0].value, 1);
      assert.equal(batch[1].results[0].value, 2);
      // This table exists only in the disposable simulator, never in migrations.
      await db
        .prepare("CREATE VIRTUAL TABLE phase0_search USING fts5(body)")
        .run();
      await db
        .prepare("INSERT INTO phase0_search(body) VALUES (?)")
        .bind("fictional algebra")
        .run();
      const found = await db
        .prepare("SELECT body FROM phase0_search WHERE phase0_search MATCH ?")
        .bind("algebra")
        .all();
      assert.equal(found.results.length, 1);
    });
    await t.test(
      "R2 put, get, metadata, delete and missing object",
      async () => {
        const bucket = await mf.getR2Bucket(hosting.r2);
        const key = "phase0/synthetic.txt";
        await bucket.put(key, "fictional storage probe", {
          httpMetadata: { contentType: "text/plain" },
        });
        const object = await bucket.get(key);
        assert.equal(await object.text(), "fictional storage probe");
        assert.equal(object.httpMetadata.contentType, "text/plain");
        await bucket.delete(key);
        assert.equal(await bucket.get(key), null);
      },
    );
  } finally {
    await mf.dispose();
  }
});
