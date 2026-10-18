/**
 * Stuck-check recovery must not depend on process timezone.
 *
 * SQLite `datetime('now')` stores UTC without a zone suffix. Parsing that
 * with `Date.parse` treats it as local time — verified below — which made
 * recovery late west of UTC and premature east of UTC.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

process.env.PAGEPULSE_DB = ':memory:';
process.env.NODE_ENV = 'test';

const { getDb, closeDb } = await import('../src/db.js');
const { recoverStuckCheckingMonitors } = await import('../src/lib/stuckChecks.js');
const { markMonitorCheckRunningForTests, clearMonitorCheckRunningForTests } = await import('../src/lib/checkRunner.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const probePath = path.join(here, 'helpers', 'stuckRecoveryProbe.ts');

beforeEach(() => {
  closeDb();
  getDb();
});

afterEach(() => {
  closeDb();
});

function runProbe(tz: string, mode: 'fresh' | 'stale') {
  const r = spawnSync(process.execPath, ['--import', 'tsx', probePath, mode], {
    cwd: path.resolve(here, '..'),
    env: { ...process.env, TZ: tz, PAGEPULSE_DB: ':memory:', NODE_ENV: 'test' },
    encoding: 'utf8'
  });
  if (r.status !== 0) {
    throw new Error(`probe failed under TZ=${tz} mode=${mode}:\n${r.stderr}\n${r.stdout}`);
  }
  const line = r.stdout.trim().split('\n').at(-1)!;
  return JSON.parse(line) as {
    tz: string;
    mode: string;
    recoveredIds: number[];
    status: string;
  };
}

describe('Date.parse hazard on SQLite datetime strings', () => {
  it('parses the same SQLite UTC string differently under different TZs', () => {
    const script = `
      const s = '2026-10-18 04:00:00';
      console.log(JSON.stringify({ tz: process.env.TZ, ms: Date.parse(s), iso: new Date(Date.parse(s)).toISOString() }));
    `;
    const run = (tz: string) => {
      const r = spawnSync(process.execPath, ['-e', script], {
        env: { ...process.env, TZ: tz },
        encoding: 'utf8'
      });
      expect(r.status).toBe(0);
      return JSON.parse(r.stdout.trim()) as { tz: string; ms: number; iso: string };
    };
    const utc = run('UTC');
    const la = run('America/Los_Angeles');
    const kolkata = run('Asia/Kolkata');
    expect(utc.iso).toBe('2026-10-18T04:00:00.000Z');
    expect(la.iso).toBe('2026-10-18T11:00:00.000Z');
    expect(kolkata.iso).toBe('2026-10-17T22:30:00.000Z');
    expect(la.ms).not.toBe(utc.ms);
    expect(kolkata.ms).not.toBe(utc.ms);
  });

  it('proves the old Date.parse age check would mark a fresh SQLite row stale under Asia/Kolkata', () => {
    // Reproduces the pre-fix bug without calling recoverStuckCheckingMonitors:
    // datetime('now') is UTC-without-zone; Date.parse treats it as local.
    const script = `
      import Database from 'better-sqlite3';
      const db = new Database(':memory:');
      const { t } = db.prepare("SELECT datetime('now') AS t").get();
      const ageMs = Date.now() - Date.parse(t);
      console.log(JSON.stringify({
        tz: process.env.TZ,
        sqliteNow: t,
        ageMs,
        wouldRecoverWith5MinGrace: ageMs > 5 * 60 * 1000
      }));
    `;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: path.resolve(here, '..'),
      env: { ...process.env, TZ: 'Asia/Kolkata' },
      encoding: 'utf8'
    });
    expect(r.status, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout.trim()) as { wouldRecoverWith5MinGrace: boolean; ageMs: number };
    expect(out.ageMs).toBeGreaterThan(5 * 60 * 1000);
    expect(out.wouldRecoverWith5MinGrace).toBe(true);
  });
});

describe('recoverStuckCheckingMonitors timezone safety', () => {
  it('does not recover a fresh checking row under Asia/Kolkata (Date.parse would)', () => {
    const out = runProbe('Asia/Kolkata', 'fresh');
    expect(out.recoveredIds).toHaveLength(0);
    expect(out.status).toBe('checking');
  });

  it('still recovers a 10-minute-old checking row under America/Los_Angeles', () => {
    const out = runProbe('America/Los_Angeles', 'stale');
    expect(out.recoveredIds).toHaveLength(1);
    expect(out.status).toBe('failed');
  });

  it('matches UTC behavior for both fresh and stale rows', () => {
    expect(runProbe('UTC', 'fresh').status).toBe('checking');
    expect(runProbe('UTC', 'stale').status).toBe('failed');
  });
});

describe('recoverStuckCheckingMonitors skips live in-process checks', () => {
  it('does not mark a monitor failed while runCheck is in flight', () => {
    const id = Number(
      getDb()
        .prepare(
          `INSERT INTO monitors (name, url, userIntent, intentJson, checkFrequency, status, updatedAt)
           VALUES ('Live', 'https://example.com', 'watch', '{}', 'hourly', 'checking', datetime('now', '-30 minutes'))`
        )
        .run().lastInsertRowid
    );
    markMonitorCheckRunningForTests(id);
    try {
      const result = recoverStuckCheckingMonitors();
      expect(result.skippedRunningIds).toContain(id);
      expect(result.recoveredIds).not.toContain(id);
      const row = getDb().prepare('SELECT status FROM monitors WHERE id = ?').get(id) as { status: string };
      expect(row.status).toBe('checking');
    } finally {
      clearMonitorCheckRunningForTests(id);
    }
  });
});
