import fs from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required to verify migrations.");
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1, connect_timeout: 5, prepare: false });
const migrationsDir = path.resolve(process.cwd(), "db/migrations");

try {
  const files = (await fs.readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const expected = files.map((file) => file.replace(/\.sql$/, ""));

  const tableRows = await sql`
    select to_regclass('public.schema_migrations')::text as table_name
  `;
  if (!tableRows[0]?.table_name) {
    console.error("schema_migrations does not exist; migrations have not been applied.");
    process.exit(1);
  }

  const appliedRows = await sql`select id from schema_migrations order by id`;
  const applied = appliedRows.map((row) => row.id);
  const expectedSet = new Set(expected);
  const appliedSet = new Set(applied);
  const missing = expected.filter((id) => !appliedSet.has(id));
  const unknown = applied.filter((id) => !expectedSet.has(id));

  if (missing.length || unknown.length) {
    console.error(JSON.stringify({ status: "migration_mismatch", missing, unknown }, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify({ status: "ok", applied: applied.length, latest: applied.at(-1) ?? null }));
} finally {
  await sql.end({ timeout: 2 });
}
