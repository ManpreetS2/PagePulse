/**
 * Recover monitors stuck in `checking` after a crash, restart, or hung check.
 * The scheduler deliberately skips `checking` rows to avoid double-runs, so
 * without recovery a monitor would never be scheduled again.
 */
import { getDb } from '../db.js';
import { computeNextCheck } from './checkRunner.js';
import type { CheckFrequency, MonitorRow } from '../types.js';

/** How long a check may stay in `checking` before we treat it as abandoned. */
export const STUCK_CHECKING_MS = 5 * 60_000;

export interface RecoverStuckResult {
  recoveredIds: number[];
}

/**
 * Mark abandoned `checking` monitors as failed and restore a nextCheckAt
 * so the scheduler can pick them up again.
 *
 * @param olderThanMs Only recover rows whose updatedAt is at least this old.
 *   Pass 0 to recover every `checking` row (used on process startup).
 */
export function recoverStuckCheckingMonitors(olderThanMs = STUCK_CHECKING_MS): RecoverStuckResult {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM monitors WHERE status = 'checking'").all() as MonitorRow[];
  const recoveredIds: number[] = [];
  const cutoff = Date.now() - olderThanMs;

  for (const row of rows) {
    const updatedMs = Date.parse(row.updatedAt);
    // On startup (olderThanMs === 0) always recover. Otherwise require staleness.
    if (olderThanMs > 0 && Number.isFinite(updatedMs) && updatedMs > cutoff) continue;

    const nextCheckAt = computeNextCheck(row.checkFrequency as CheckFrequency);
    db.prepare(
      `UPDATE monitors
       SET status = 'failed',
           failureCount = failureCount + 1,
           lastError = ?,
           lastCheckSummary = 'failed',
           nextCheckAt = ?,
           updatedAt = datetime('now')
       WHERE id = ?`
    ).run(
      olderThanMs === 0
        ? 'Recovered from an interrupted check after the server restarted. Run Check now or wait for the next schedule.'
        : 'Recovered from a check that stayed in progress too long. Run Check now or wait for the next schedule.',
      nextCheckAt,
      row.id
    );
    recoveredIds.push(row.id);
  }

  return { recoveredIds };
}
