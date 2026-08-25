import postgres from "postgres";

if (process.env.NODE_ENV === "production") throw new Error("Local review-integrity verification is disabled in production.");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");

const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5, prepare: false });

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
  const lockedRows = await sql`
    SELECT me.id, me.final_score, hs.id AS snapshot_id, hs.checksum, hs.payload
    FROM member_evaluations me
    JOIN historical_snapshots hs ON hs.member_evaluation_id = me.id
    WHERE me.status = 'LOCKED'
    ORDER BY me.locked_at DESC
    LIMIT 1
  `;
  const locked = lockedRows[0];
  if (!locked) throw new Error("No LOCKED evaluation with a historical snapshot was found.");
  if (!/^[a-f0-9]{64}$/.test(locked.checksum)) throw new Error("Historical snapshot checksum is not a SHA-256 hex digest.");
  if (locked.payload?.evaluation?.finalScore !== Number(locked.final_score)) throw new Error("Snapshot final score does not match the locked evaluation final score.");
  console.log("locked_snapshot_shape=PASS");

  const finalizedRows = await sql`
    SELECT me.id, ce.id AS criterion_evaluation_id, ce.final_score
    FROM member_evaluations me
    JOIN criterion_evaluations ce ON ce.member_evaluation_id = me.id
    WHERE me.status = 'FINALIZED'
    ORDER BY me.finalized_at DESC, ce.id
    LIMIT 1
  `;
  const finalized = finalizedRows[0];
  if (!finalized) throw new Error("No FINALIZED evaluation was found for immutability probes.");

  const criticalRows = await sql`
    SELECT DISTINCT me.id
    FROM member_evaluations me
    JOIN data_quality_issues dqi ON dqi.member_evaluation_id = me.id
    WHERE me.status = 'HEAD_REVIEW'
      AND dqi.severity = 'CRITICAL'
      AND dqi.resolved_at IS NULL
    LIMIT 1
  `;
  const critical = criticalRows[0];
  if (!critical) throw new Error("No HEAD_REVIEW evaluation with unresolved CRITICAL quality was found.");

  const periodRows = await sql`
    SELECT id FROM evaluation_periods WHERE status = 'HEAD_REVIEW' ORDER BY updated_at DESC LIMIT 1
  `;
  const period = periodRows[0];
  if (!period) throw new Error("No HEAD_REVIEW period was found.");

  const adjustmentRows = await sql`SELECT id FROM adjustments ORDER BY created_at DESC LIMIT 1`;
  const adjustment = adjustmentRows[0];
  if (!adjustment) throw new Error("No review adjustment exists for append-only verification.");

  await expectDatabaseBlock("critical_direct_lock_skip", async (tx) => {
    await tx`UPDATE member_evaluations SET status = 'LOCKED', locked_at = now() WHERE id = ${critical.id}`;
  });

  await expectDatabaseBlock("finalized_member_score_rewrite", async (tx) => {
    await tx`UPDATE member_evaluations SET final_score = final_score - 0.01 WHERE id = ${finalized.id}`;
  });

  await expectDatabaseBlock("finalized_criterion_score_rewrite", async (tx) => {
    await tx`UPDATE criterion_evaluations SET final_score = final_score - 0.01 WHERE id = ${finalized.criterion_evaluation_id}`;
  });

  await expectDatabaseBlock("locked_member_rewrite", async (tx) => {
    await tx`UPDATE member_evaluations SET updated_at = now() WHERE id = ${locked.id}`;
  });

  await expectDatabaseBlock("adjustment_update", async (tx) => {
    await tx`UPDATE adjustments SET reason = reason || ' verify' WHERE id = ${adjustment.id}`;
  });

  await expectDatabaseBlock("adjustment_delete", async (tx) => {
    await tx`DELETE FROM adjustments WHERE id = ${adjustment.id}`;
  });

  await expectDatabaseBlock("snapshot_update", async (tx) => {
    await tx`UPDATE historical_snapshots SET checksum = repeat('a', 64) WHERE id = ${locked.snapshot_id}`;
  });

  await expectDatabaseBlock("snapshot_delete", async (tx) => {
    await tx`DELETE FROM historical_snapshots WHERE id = ${locked.snapshot_id}`;
  });

  await expectDatabaseBlock("period_backward_transition", async (tx) => {
    await tx`UPDATE evaluation_periods SET status = 'LEADER_REVIEW' WHERE id = ${period.id}`;
  });

  console.log("review_finalization_lock_integrity=PASS");
} finally {
  await sql.end({ timeout: 2 });
}
