/**
 * Child-process probe for stuck-check recovery under an explicit TZ.
 * Usage: tz=<TZ> mode=<fresh|stale> npx tsx test/helpers/stuckRecoveryProbe.ts
 */
process.env.PAGEPULSE_DB = ':memory:';
process.env.NODE_ENV = 'test';

const mode = process.argv[2] ?? 'fresh';

const { getDb, closeDb } = await import('../../src/db.js');
const { recoverStuckCheckingMonitors } = await import('../../src/lib/stuckChecks.js');

closeDb();
const db = getDb();
const updatedAtSql = mode === 'stale' ? "datetime('now', '-10 minutes')" : "datetime('now')";
const id = Number(
  db
    .prepare(
      `INSERT INTO monitors (name, url, userIntent, intentJson, checkFrequency, status, updatedAt)
       VALUES ('Probe', 'https://example.com', 'watch', '{}', 'hourly', 'checking', ${updatedAtSql})`
    )
    .run().lastInsertRowid
);
const result = recoverStuckCheckingMonitors();
const row = db.prepare('SELECT status FROM monitors WHERE id = ?').get(id) as { status: string };
process.stdout.write(
  JSON.stringify({
    tz: process.env.TZ ?? '',
    mode,
    id,
    recoveredIds: result.recoveredIds,
    skippedRunningIds: result.skippedRunningIds,
    status: row.status
  })
);
closeDb();
