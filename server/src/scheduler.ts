/**
 * Background scheduler.
 *
 * Every minute, finds monitors whose nextCheckAt is due and runs them
 * with a small concurrency limit and per-domain rate limiting. Scheduled
 * monitoring only works while this Node server process is running — that
 * is documented honestly in the README and the UI.
 */
import cron from 'node-cron';
import { getDb } from './db.js';
import { config } from './config.js';
import { runCheck } from './lib/checkRunner.js';
import type { MonitorRow } from './types.js';

const lastFetchByHost = new Map<string, number>();
let tickRunning = false;

export async function schedulerTick(): Promise<void> {
  if (tickRunning) return;
  tickRunning = true;
  try {
    const due = getDb()
      .prepare(
        `SELECT * FROM monitors
         WHERE status NOT IN ('paused', 'checking') AND checkFrequency != 'manual'
           AND nextCheckAt IS NOT NULL AND nextCheckAt <= ?
         ORDER BY nextCheckAt ASC LIMIT 10`
      )
      .all(new Date().toISOString()) as MonitorRow[];

    for (const monitor of due) {
      // Per-domain politeness: skip this tick if the host was hit recently.
      let host = '';
      try {
        host = new URL(monitor.url).host;
      } catch {
        /* runCheck will record the invalid URL */
      }
      const last = lastFetchByHost.get(host) ?? 0;
      if (host && Date.now() - last < config.scheduler.perDomainIntervalMs) continue;
      lastFetchByHost.set(host, Date.now());
      try {
        await runCheck(monitor.id);
      } catch (err) {
        console.error(`[scheduler] check for monitor ${monitor.id} threw:`, err);
      }
    }
  } finally {
    tickRunning = false;
  }
}

export function startScheduler(): void {
  if (!config.scheduler.enabled) return;
  cron.schedule('* * * * *', () => {
    void schedulerTick();
  });
  console.log('[scheduler] running — due monitors are checked every minute.');
}
