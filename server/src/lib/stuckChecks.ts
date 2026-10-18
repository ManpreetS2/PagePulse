/**
 * Recover monitors stuck in `checking` after a crash, restart, or hung check.
 * The scheduler deliberately skips `checking` rows to avoid double-runs, so
 * without recovery a monitor would never be scheduled again.
 *
 * Age comparison is done entirely in SQLite (`datetime('now', …)`) because
 * `datetime('now')` writes UTC *without* a timezone suffix. Parsing that
 * string with `Date.parse` treats it as local time and breaks under any
 * non-UTC TZ (late recovery west of UTC; premature recovery east of UTC).
 */
import { getDb } from '../db.js';
import { computeNextCheck, isMonitorCheckRunning } from './checkRunner.js';
import type { CheckFrequency, MonitorRow } from '../types.js';

/** How long a check may stay in `checking` before we treat it as abandoned. */
export const STUCK_CHECKING_MS = 5 * 60_000;

export interface RecoverStuckResult {
  recoveredIds: number[];
  skippedRunningIds: number[];
}

/**
 * Mark abandoned `checking` monitors as failed and restore a nextCheckAt
 * so the scheduler can pick them up again.
 *
 * @param olderThanMs Only recover rows whose updatedAt is at least this old.
 *   Pass 0 to recover every `checking` row that is not actively running
 *   in this process (used on process startup).
 */
export function recoverStuckCheckingMonitors(olderThanMs = STUCK_CHECKING_MS): RecoverStuckResult {
  const db = getDb();
  const recoveredIds: number[] = [];
  const skippedRunningIds: number[] = [];

  // Compare timestamps inside SQLite so the result does not depend on the
  // process timezone. `datetime('now')` and stored updatedAt are both UTC.
  const rows =
    olderThanMs <= 0
      ? (db.prepare("SELECT * FROM monitors WHERE status = 'checking'").all() as MonitorRow[])
      : (db
          .prepare(
            `SELECT * FROM monitors
             WHERE status = 'checking'
               AND datetime(updatedAt) <= datetime('now', ?)`
          )
          .all(`-${Math.max(1, Math.round(olderThanMs / 1000))} seconds`) as MonitorRow[]);

  for (const row of rows) {
    // A live check in this process must never be clobbered mid-flight.
    if (isMonitorCheckRunning(row.id)) {
      skippedRunningIds.push(row.id);
      continue;
    }

    const nextCheckAt = computeNextCheck(row.checkFrequency as CheckFrequency);
    db.prepare(
      `UPDATE monitors
       SET status = 'failed',
           failureCount = failureCount + 1,
           lastError = ?,
           lastCheckSummary = 'failed',
           nextCheckAt = ?,
           updatedAt = datetime('now')
       WHERE id = ? AND status = 'checking'`
    ).run(
      olderThanMs <= 0
        ? 'Recovered from an interrupted check after the server restarted. Run Check now or wait for the next schedule.'
        : 'Recovered from a check that stayed in progress too long. Run Check now or wait for the next schedule.',
      nextCheckAt,
      row.id
    );
    recoveredIds.push(row.id);
  }

  return { recoveredIds, skippedRunningIds };
}
