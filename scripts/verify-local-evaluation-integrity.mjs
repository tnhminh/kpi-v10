import postgres from "postgres";

if (process.env.NODE_ENV === "production") throw new Error("Local integrity verification is disabled in production.");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");

const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5, prepare: false });
const ROLLBACK_SENTINEL = "__LOCAL_VERIFY_ROLLBACK__";

async function expectRollbackOnly(work) {
  try {
    await sql.begin(async (tx) => {
      await work(tx);
      throw new Error(ROLLBACK_SENTINEL);
    });
  } catch (error) {
    if (error instanceof Error && error.message === ROLLBACK_SENTINEL) return;
    throw error;
  }
}

async function expectDatabaseBlock(label, work) {
  let blocked = false;
  try {
    await sql.begin(work);
  } catch (error) {
    blocked = true;
    console.log(`${label}=BLOCKED:${error?.code ?? "unknown"}`);
  }
  if (!blocked) throw new Error(`${label} was unexpectedly allowed.`);
}

try {
  const metricRows = await sql`
    SELECT md.id
    FROM metric_definitions md
    JOIN metric_configurations mc ON mc.metric_definition_id = md.id
    JOIN criteria c ON c.id = mc.criterion_id
    JOIN kpi_versions kv ON kv.id = c.kpi_version_id
    WHERE kv.submitted_at IS NOT NULL
    LIMIT 1
  `;
  const metricId = metricRows[0]?.id;
  if (!metricId) throw new Error("No metric referenced by a submitted KPI version was found.");

  await expectRollbackOnly(async (tx) => {
    await tx`UPDATE metric_definitions SET active = NOT active, updated_at = now() WHERE id = ${metricId}`;
  });
  console.log("metric_active_only_update=ALLOWED");

  await expectDatabaseBlock("metric_semantic_update", async (tx) => {
    await tx`UPDATE metric_definitions SET name = name || ' verify-change', updated_at = now() WHERE id = ${metricId}`;
  });

  const assignmentRows = await sql`
    SELECT pka.id
    FROM period_kpi_assignments pka
    JOIN evaluation_periods ep ON ep.id = pka.period_id
    WHERE ep.status <> 'UPCOMING'::period_status
    LIMIT 1
  `;
  const assignmentId = assignmentRows[0]?.id;
  if (!assignmentId) throw new Error("No non-upcoming period assignment was found.");

  await expectDatabaseBlock("period_assignment_update_after_collection", async (tx) => {
    await tx`UPDATE period_kpi_assignments SET assigned_at = now() WHERE id = ${assignmentId}`;
  });

  await expectDatabaseBlock("period_assignment_delete_after_collection", async (tx) => {
    await tx`DELETE FROM period_kpi_assignments WHERE id = ${assignmentId}`;
  });

  const evaluationRows = await sql`
    SELECT id
    FROM member_evaluations
    WHERE resolved_membership_id IS NOT NULL
    LIMIT 1
  `;
  const evaluationId = evaluationRows[0]?.id;
  if (!evaluationId) throw new Error("No resolved member evaluation was found.");

  await expectDatabaseBlock("member_evaluation_missing_membership", async (tx) => {
    await tx`UPDATE member_evaluations SET resolved_membership_id = NULL, updated_at = now() WHERE id = ${evaluationId}`;
  });

  const mismatchRows = await sql`
    SELECT me.id AS evaluation_id, tm.id AS wrong_membership_id
    FROM member_evaluations me
    JOIN team_memberships tm ON tm.member_id <> me.member_id
    WHERE me.resolved_membership_id IS NOT NULL
    LIMIT 1
  `;
  if (!mismatchRows[0]) throw new Error("No mismatched membership candidate was found.");
  await expectDatabaseBlock("member_evaluation_mismatched_membership", async (tx) => {
    await tx`UPDATE member_evaluations SET resolved_membership_id = ${mismatchRows[0].wrong_membership_id}, updated_at = now() WHERE id = ${mismatchRows[0].evaluation_id}`;
  });

  console.log("historical_integrity=PASS");
} finally {
  await sql.end({ timeout: 2 });
}
