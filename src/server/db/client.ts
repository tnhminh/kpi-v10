import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { parseServerEnv } from "@/server/env";
import * as schema from "./schema";

let client: Sql | undefined;
let database: ReturnType<typeof createDatabase> | undefined;

function createDatabase(sqlClient: Sql) {
  return drizzle({ client: sqlClient, schema });
}

export function getSqlClient(): Sql {
  if (!client) {
    const env = parseServerEnv();
    client = postgres(env.DATABASE_URL, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 5,
      prepare: false,
    });
  }
  return client;
}

export function getDb() {
  if (!database) database = createDatabase(getSqlClient());
  return database;
}

export async function checkDatabase(): Promise<boolean> {
  try {
    const sqlClient = getSqlClient();
    await sqlClient`select 1 as ok`;
    return true;
  } catch {
    return false;
  }
}

export async function closeDatabase(): Promise<void> {
  if (client) await client.end({ timeout: 2 });
  client = undefined;
  database = undefined;
}
