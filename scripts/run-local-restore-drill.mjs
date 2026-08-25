import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import postgres from "postgres";

if (process.env.NODE_ENV === "production") throw new Error("Local restore drill is disabled in production.");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
if (!process.env.AUTH_SECRET) throw new Error("AUTH_SECRET is required to boot the restored runtime.");

const sourceUrl = new URL(process.env.DATABASE_URL);
const sourceDb = decodeURIComponent(sourceUrl.pathname.replace(/^\//, ""));
if (!sourceDb) throw new Error("DATABASE_URL must include a database name.");

const workDir = await mkdtemp(join(tmpdir(), "kpi-restore-"));
const dataDir = join(workDir, "pgdata");
const dumpPath = join(workDir, "backup.dump");
const postgresLog = join(workDir, "postgres.log");
const targetDb = "kpi_restore";
const targetUser = "kpi_restore_admin";

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not allocate a local proof port.")));
        return;
      }
      const port = address.port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

const targetPort = await findFreePort();
await mkdir(dataDir, { recursive: true });

function sourcePgEnv() {
  return {
    ...process.env,
    PGHOST: sourceUrl.hostname,
    PGPORT: sourceUrl.port || "5432",
    PGUSER: decodeURIComponent(sourceUrl.username),
    PGPASSWORD: decodeURIComponent(sourceUrl.password),
    PGDATABASE: sourceDb,
  };
}

function targetPgEnv(database = targetDb) {
  const env = {
    ...process.env,
    PGHOST: "127.0.0.1",
    PGPORT: String(targetPort),
    PGUSER: targetUser,
    PGDATABASE: database,
  };
  delete env.PGPASSWORD;
  return env;
}

function run(command, args, env, timeoutMs = 120_000, quiet = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: quiet ? "ignore" : ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${command} timed out.`)); }, timeoutMs);
    if (!quiet) {
      child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
      child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    }
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited ${code}${quiet ? "" : `: ${stderr.trim() || stdout.trim()}`}`));
    });
  });
}

async function waitForPostgres(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let last = "not_started";
  while (Date.now() < deadline) {
    const probe = postgres(`postgresql://${targetUser}@127.0.0.1:${targetPort}/postgres`, { max: 1, connect_timeout: 1, prepare: false });
    try {
      await probe`SELECT 1`;
      await probe.end({ timeout: 1 });
      return;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
      try { await probe.end({ timeout: 1 }); } catch {}
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`Temporary PostgreSQL did not become ready: ${last}`);
}

async function waitForReady(baseUrl, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  let last = "not_started";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/ready`);
      last = `HTTP ${response.status}`;
      if (response.status === 200) return;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Restored standalone runtime did not become ready: ${last}`);
}

let clusterStarted = false;
let appProcess = null;
let restoredSql = null;
try {
  await run("pg_dump", ["--format=custom", "--no-owner", "--no-acl", `--file=${dumpPath}`], sourcePgEnv());
  await run("initdb", ["-D", dataDir, "-A", "trust", "-U", targetUser, "--encoding=UTF8", "--no-locale"], process.env, 120_000);
  await run("pg_ctl", ["-D", dataDir, "-l", postgresLog, "-o", `-p ${targetPort} -h 127.0.0.1`, "-w", "start"], process.env, 60_000, true);
  clusterStarted = true;
  await waitForPostgres();

  await run("createdb", [targetDb], targetPgEnv("postgres"), 30_000);
  await run("pg_restore", ["--no-owner", "--no-acl", `--dbname=${targetDb}`, dumpPath], targetPgEnv(), 120_000);

  const restoreUrl = `postgresql://${targetUser}@127.0.0.1:${targetPort}/${targetDb}`;
  restoredSql = postgres(restoreUrl, { max: 1, connect_timeout: 5, prepare: false });
  const migrations = await restoredSql`SELECT id FROM schema_migrations ORDER BY id`;
  const counts = (await restoredSql`
    SELECT
      (SELECT count(*)::int FROM organizations) AS organizations,
      (SELECT count(*)::int FROM teams) AS teams,
      (SELECT count(*)::int FROM members) AS members,
      (SELECT count(*)::int FROM kpi_templates) AS kpi_templates,
      (SELECT count(*)::int FROM member_evaluations) AS evaluations,
      (SELECT count(*)::int FROM audit_events) AS audit_events,
      (SELECT count(*)::int FROM historical_snapshots) AS historical_snapshots
  `)[0];
  const guards = await restoredSql`
    SELECT tgname
    FROM pg_trigger
    WHERE NOT tgisinternal
      AND tgname IN ('audit_events_append_only_guard', 'member_evaluation_final_state_guard', 'historical_snapshot_state_guard')
    ORDER BY tgname
  `;

  if (migrations.length !== 14 || migrations.at(-1)?.id !== "0014_user_onboarding") {
    throw new Error(`Restored migration parity mismatch: ${migrations.length} migrations, latest ${migrations.at(-1)?.id ?? "none"}.`);
  }
  for (const [key, value] of Object.entries(counts)) {
    if (!Number.isInteger(value) || value <= 0) throw new Error(`Restored representative table ${key} is empty.`);
  }
  if (guards.length !== 3) throw new Error(`Expected integrity triggers are missing after restore; found ${guards.length}/3.`);

  const appPort = await findFreePort();
  const baseUrl = `http://127.0.0.1:${appPort}`;
  appProcess = spawn(process.execPath, [".next/standalone/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(appPort),
      HOSTNAME: "127.0.0.1",
      APP_URL: baseUrl,
      DATABASE_URL: restoreUrl,
      AUTH_SECRET: process.env.AUTH_SECRET,
      LOG_LEVEL: "error",
      METRICS_TOKEN: process.env.METRICS_TOKEN || "restore-proof-metrics-token-value-at-least-32-characters",
    },
    stdio: "ignore",
    windowsHide: true,
  });
  await waitForReady(baseUrl);

  console.log(JSON.stringify({
    status: "ok",
    sourceDatabase: sourceDb,
    restoreTarget: "isolated-temporary-postgresql-cluster",
    migrationParity: `${migrations.length}/14`,
    latestMigration: migrations.at(-1)?.id,
    representativeCounts: counts,
    integrityTriggers: guards.map((row) => row.tgname),
    standaloneReady: true,
    cleanup: "temporary cluster and dump removed after proof",
  }, null, 2));
} finally {
  if (appProcess && !appProcess.killed) {
    appProcess.kill();
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  if (restoredSql) await restoredSql.end({ timeout: 2 });
  if (clusterStarted) {
    try { await run("pg_ctl", ["-D", dataDir, "-m", "fast", "-w", "stop"], process.env, 30_000, true); }
    catch (error) { console.error(`Restore cluster cleanup warning: ${error instanceof Error ? error.message : String(error)}`); }
  }
  await rm(workDir, { recursive: true, force: true });
}
