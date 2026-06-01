// LegalBridge migration runner (Phase 0 / D2)
//
// Applies ordered migrations/NNNN_*.sql against the database referenced by
// DATABASE_URL, tracking applied versions in `schema_migrations`. Each file
// runs in its own transaction and is recorded with a checksum. Idempotent:
// already-applied versions are skipped.
//
// Design ref: docs/service-architecture.md §8 (D2). Neither app service
// migrates at boot — this runner is the single owner of DDL.
//
//   DATABASE_URL=postgres://... node run.mjs            # apply pending
//   DATABASE_URL=postgres://... node run.mjs --dry-run  # list pending only
//
// In production this runs as a Cloud Run Job (image built from
// Dockerfile.migrate) or a Cloud Build step, using the `lb_migrate` role.

import pg from "pg";
import { readFileSync, readdirSync } from "fs";
import { createHash } from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dryRun = process.argv.includes("--dry-run");

const conn = process.env.DATABASE_URL;
if (!conn) {
  console.error("ERROR: DATABASE_URL is not set.");
  process.exit(1);
}
const isLocal = conn.includes("localhost") || conn.includes("127.0.0.1");
const ssl = isLocal ? false : { rejectUnauthorized: false };

const client = new pg.Client({ connectionString: conn, ssl });

function migrationFiles() {
  return readdirSync(__dirname)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
}

function checksum(text) {
  return createHash("sha256").update(text).digest("hex");
}

async function main() {
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     TEXT PRIMARY KEY,
      checksum    TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const appliedRows = (await client.query(
    "SELECT version, checksum FROM schema_migrations"
  )).rows;
  const applied = new Map(appliedRows.map((r) => [r.version, r.checksum]));

  const files = migrationFiles();
  const pending = [];

  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    const sql = readFileSync(path.join(__dirname, file), "utf8");
    const sum = checksum(sql);

    if (applied.has(version)) {
      if (applied.get(version) !== sum) {
        console.warn(
          `WARN: ${version} already applied but checksum differs ` +
            `(file changed after apply). Migrations are immutable — ` +
            `create a new migration instead of editing ${file}.`
        );
      }
      continue;
    }
    pending.push({ version, file, sql, sum });
  }

  if (pending.length === 0) {
    console.log(`Up to date. ${applied.size} migration(s) already applied.`);
    await client.end();
    return;
  }

  console.log(`Pending: ${pending.map((p) => p.version).join(", ")}`);
  if (dryRun) {
    console.log("(--dry-run: nothing applied)");
    await client.end();
    return;
  }

  for (const { version, file, sql, sum } of pending) {
    process.stdout.write(`Applying ${file} ... `);
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)",
        [version, sum]
      );
      await client.query("COMMIT");
      console.log("done");
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`\nFAILED on ${file}: ${err.message}`);
      await client.end();
      process.exit(1);
    }
  }

  console.log(`Applied ${pending.length} migration(s).`);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
