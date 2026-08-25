import fs from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required to run migrations.");
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1, connect_timeout: 5, prepare: false });
const migrationsDir = path.resolve(process.cwd(), "db/migrations");

try {
  await sql`create table if not exists schema_migrations (id text primary key, applied_at timestamptz not null default now())`;
  const appliedRows = await sql`select id from schema_migrations`;
  const applied = new Set(appliedRows.map((row) => row.id));
  const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();

  for (const file of files) {
    const id = file.replace(/\.sql$/, "");
    if (applied.has(id)) continue;
    const body = await fs.readFile(path.join(migrationsDir, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into schema_migrations (id) values (${id})`;
    });
    console.log(`Applied migration ${id}`);
  }
} finally {
  await sql.end({ timeout: 2 });
}
