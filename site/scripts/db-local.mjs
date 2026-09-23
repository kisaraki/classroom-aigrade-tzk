import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/d1";
import { migrate } from "drizzle-orm/d1/migrator";
import { Miniflare } from "miniflare";
import { seedFictional } from "../db/seed-fictional.ts";

export const migrationsFolder = fileURLToPath(
  new URL("../drizzle/", import.meta.url),
);

export async function createIsolatedDatabase() {
  const mf = new Miniflare({
    modules: true,
    compatibilityDate: "2026-05-15",
    cf: false,
    d1Databases: ["DB"],
    d1Persist: false,
    script:
      "export default { fetch() { return new Response('isolated migration test'); } };",
  });
  return { mf, db: await mf.getD1Database("DB") };
}

/** Verifies the complete applied prefix, not just the most recent timestamp. */
export async function migrationPreflight(db) {
  const migrations = readMigrationFiles({ migrationsFolder });
  const table = await db
    .prepare(
      "SELECT name FROM sqlite_schema WHERE name = '__drizzle_migrations'",
    )
    .first();
  const applied = table
    ? (
        await db
          .prepare(
            "SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at",
          )
          .all()
      ).results
    : [];
  if (
    applied.length > migrations.length ||
    applied.some(
      (row, i) =>
        row.hash !== migrations[i].hash ||
        Number(row.created_at) !== migrations[i].folderMillis,
    )
  )
    throw new Error("MIGRATION_HISTORY_MISMATCH");
  const objects = new Set(
    (await db.prepare("SELECT name FROM sqlite_schema").all()).results.map(
      (row) => row.name,
    ),
  );
  for (const migration of migrations.slice(0, applied.length)) {
    for (const statement of migration.sql) {
      const match =
        /CREATE\s+(?:UNIQUE\s+|VIRTUAL\s+)?(?:TABLE|INDEX|TRIGGER)\s+[`"]?(\w+)/i.exec(
          statement,
        );
      if (match && !objects.has(match[1]))
        throw new Error("MIGRATION_SCHEMA_OBJECT_MISSING");
    }
  }
  const fk = await db.prepare("PRAGMA foreign_key_check").all();
  if (fk.results.length) throw new Error("FOREIGN_KEY_CHECK_FAILED");
  const integrity = await db.prepare("PRAGMA quick_check").all();
  if (
    integrity.results.length !== 1 ||
    integrity.results[0].quick_check !== "ok"
  )
    throw new Error("INTEGRITY_CHECK_FAILED");
  if (!applied.length) {
    const existing = await db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('__drizzle_migrations', '_cf_METADATA')",
      )
      .all();
    if (existing.results.length) throw new Error("UNTRACKED_SCHEMA");
  }
  return {
    applied: applied.length,
    pending: migrations.length - applied.length,
    foreignKeys: "ok",
    integrity: "ok",
  };
}

export async function migrateLocalDatabase(db) {
  await migrationPreflight(db);
  await migrate(drizzle(db), { migrationsFolder });
  return migrationPreflight(db);
}

export function fictionalKeys() {
  return {
    encryption: {
      version: 1,
      bytes: crypto.getRandomValues(new Uint8Array(32)),
    },
    lookup: [{ version: 1, bytes: crypto.getRandomValues(new Uint8Array(32)) }],
  };
}

// This executable intentionally has no remote/production/database-id option.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { mf, db } = await createIsolatedDatabase();
  try {
    const before = await migrationPreflight(db);
    const after = await migrateLocalDatabase(db);
    await seedFictional(db, fictionalKeys());
    const repeated = await migrateLocalDatabase(db);
    const students = await db
      .prepare("SELECT count(*) AS count FROM students")
      .first();
    console.log(
      JSON.stringify({
        mode: "disposable-local-only",
        before,
        after,
        repeated,
        fictionalStudents: students.count,
      }),
    );
  } finally {
    await mf.dispose();
  }
}
