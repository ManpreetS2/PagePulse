/**
 * Security + reliability regressions: DNS pinning inputs, IPv4-mapped IPv6,
 * stuck-checking recovery, and quiet-report evidence summaries.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import supertest from 'supertest';

process.env.PAGEPULSE_DB = ':memory:';
process.env.NODE_ENV = 'test';

const { createApp } = await import('../src/app.js');
const { setSelfOrigin } = await import('../src/selfOrigin.js');
const { getDb, closeDb } = await import('../src/db.js');
const { extractMappedIpv4, isPrivateIp, parsePublicUrl, resolveSafeFetchTarget, UrlGuardError } =
  await import('../src/lib/urlGuard.js');
const { recoverStuckCheckingMonitors } = await import('../src/lib/stuckChecks.js');
const { buildQuietReport } = await import('../src/lib/quietReport.js');
const { schedulerTick } = await import('../src/scheduler.js');

let server: Server;
let request: ReturnType<typeof supertest>;

beforeAll(async () => {
  closeDb();
  const app = createApp();
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  setSelfOrigin(`http://127.0.0.1:${port}`);
  request = supertest(`http://127.0.0.1:${port}`);
});

afterAll(() => {
  server.close();
  closeDb();
});

function baseUrl(): string {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return `http://127.0.0.1:${port}`;
}

describe('IPv4-mapped IPv6 and weird IP forms', () => {
  it('decodes dotted and hex ::ffff mapped addresses', () => {
    expect(extractMappedIpv4('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(extractMappedIpv4('::ffff:7f00:1')).toBe('127.0.0.1');
    expect(extractMappedIpv4('::ffff:0a00:0001')).toBe('10.0.0.1');
    expect(extractMappedIpv4('8.8.8.8')).toBeNull();
  });

  it('treats mapped loopback/private as private', () => {
    expect(isPrivateIp('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateIp('::ffff:7f00:1')).toBe(true);
    expect(isPrivateIp('::ffff:10.1.2.3')).toBe(true);
    expect(isPrivateIp('::ffff:0808:0808')).toBe(false); // 8.8.8.8
  });

  it('blocks decimal/hex/octal IPv4 forms after URL normalization', async () => {
    for (const raw of ['http://2130706433/', 'http://0x7f000001/', 'http://127.1/', 'http://0177.0.0.1/']) {
      const parsed = parsePublicUrl(raw);
      expect(parsed.hostname).toBe('127.0.0.1');
      await expect(resolveSafeFetchTarget(raw)).rejects.toThrow(UrlGuardError);
    }
  });

  it('returns pin addresses for public hostnames and self-lab pages', async () => {
    const lab = await resolveSafeFetchTarget(`${baseUrl()}/lab-pages/college-admissions`);
    expect(lab.selfLab).toBe(true);
    expect(lab.addresses.length).toBeGreaterThan(0);
    expect(lab.addresses.every((a) => a === '127.0.0.1' || a === '::1' || a.startsWith('127.'))).toBe(true);

    await expect(resolveSafeFetchTarget(`${baseUrl()}/api/health`)).rejects.toThrow(UrlGuardError);
  });
});

describe('security headers', () => {
  it('sets defensive headers on API responses', async () => {
    const res = await request.get('/api/health').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['content-security-policy']).toMatch(/default-src 'self'/);
  });
});

describe('stuck checking recovery', () => {
  beforeEach(() => {
    getDb().prepare('DELETE FROM notifications').run();
    getDb().prepare('DELETE FROM changes').run();
    getDb().prepare('DELETE FROM snapshots').run();
    getDb().prepare('DELETE FROM monitors').run();
  });

  it('recovers checking monitors on demand so the scheduler can see them again', async () => {
    const created = await request
      .post('/api/monitors')
      .send({
        name: 'Stuck recovery',
        url: `${baseUrl()}/lab-pages/college-admissions`,
        userIntent: 'Alert me if the minimum transfer GPA changes.',
        checkFrequency: 'hourly'
      })
      .expect(201);

    getDb()
      .prepare("UPDATE monitors SET status = 'checking', updatedAt = datetime('now', '-10 minutes') WHERE id = ?")
      .run(created.body.id);

    const result = recoverStuckCheckingMonitors();
    expect(result.recoveredIds).toContain(created.body.id);

    const row = getDb().prepare('SELECT status, lastCheckSummary, nextCheckAt, lastError FROM monitors WHERE id = ?').get(created.body.id) as {
      status: string;
      lastCheckSummary: string;
      nextCheckAt: string | null;
      lastError: string | null;
    };
    expect(row.status).toBe('failed');
    expect(row.lastCheckSummary).toBe('failed');
    expect(row.nextCheckAt).toBeTruthy();
    expect(row.lastError).toMatch(/Recovered/i);

    // Scheduler tick should be able to select it (due) without throwing.
    getDb().prepare("UPDATE monitors SET nextCheckAt = datetime('now', '-1 minute') WHERE id = ?").run(created.body.id);
    await schedulerTick();
    const after = getDb().prepare('SELECT status FROM monitors WHERE id = ?').get(created.body.id) as { status: string };
    expect(after.status).not.toBe('checking');
  });

  it('does not recover fresh checking monitors still within the grace window', () => {
    const id = Number(
      getDb()
        .prepare(
          `INSERT INTO monitors (name, url, userIntent, intentJson, checkFrequency, status, updatedAt)
           VALUES ('Fresh', 'https://example.com', 'watch', '{}', 'hourly', 'checking', datetime('now'))`
        )
        .run().lastInsertRowid
    );
    const result = recoverStuckCheckingMonitors();
    expect(result.recoveredIds).not.toContain(id);
    const row = getDb().prepare('SELECT status FROM monitors WHERE id = ?').get(id) as { status: string };
    expect(row.status).toBe('checking');
  });
});

describe('quiet report', () => {
  it('summarizes suppressed changes with evidence', () => {
    const report = buildQuietReport([
      {
        id: 1,
        monitorId: 1,
        oldSnapshotId: 1,
        newSnapshotId: 2,
        category: 'text_change',
        oldValue: 'a',
        newValue: 'b',
        oldEvidence: 'old sentence a',
        newEvidence: 'new sentence b',
        sectionHeading: 'GPA',
        meaningful: 0,
        intentMatched: 0,
        sectionConfidence: 0.9,
        meaningConfidence: 0.8,
        intentConfidence: 0.1,
        explanation: 'Equivalent rewording; underlying values did not change.',
        detectedAt: new Date().toISOString(),
        feedback: null
      },
      {
        id: 2,
        monitorId: 1,
        oldSnapshotId: 1,
        newSnapshotId: 2,
        category: 'date_moved_later',
        oldValue: '2026-01-01',
        newValue: '2026-02-01',
        oldEvidence: 'Deadline 2026-01-01',
        newEvidence: 'Deadline 2026-02-01',
        sectionHeading: 'Dates',
        meaningful: 1,
        intentMatched: 0,
        sectionConfidence: 0.9,
        meaningConfidence: 0.95,
        intentConfidence: 0.2,
        explanation: 'Deadline moved later. Did not match GPA intent.',
        detectedAt: new Date().toISOString(),
        feedback: null
      }
    ]);
    expect(report).not.toBeNull();
    expect(report!.suppressedCount).toBe(2);
    expect(report!.summary).toMatch(/Quiet on purpose/i);
    expect(report!.items[0]!.oldEvidence).toContain('old sentence');
    expect(report!.items.some((i) => i.meaningful && !i.intentMatched)).toBe(true);
  });

  it('returns quietReport from a real no-alert check and persists it on the monitor', async () => {
    await request.post('/api/lab/pages/transfer-gpa-workflow/reset').expect(200);
    const created = await request
      .post('/api/monitors')
      .send({
        name: 'Quiet evidence',
        url: `${baseUrl()}/lab-pages/transfer-gpa-workflow`,
        userIntent:
          'Alert me only if the minimum transferable GPA requirement changes. Ignore footer dates, formatting changes, rewording, and application deadlines.',
        checkFrequency: 'manual',
        sectionHeading: 'Minimum GPA'
      })
      .expect(201);

    await request
      .post('/api/lab/pages/transfer-gpa-workflow/mutations')
      .send({ mutations: ['reword-gpa', 'deadline-change', 'footer-year'] })
      .expect(200);

    const check = await request.post(`/api/monitors/${created.body.id}/check`).expect(200);
    expect(check.body.alertsCreated).toBe(0);
    expect(check.body.quietReport).toBeTruthy();
    expect(check.body.quietReport.suppressedCount).toBeGreaterThan(0);
    expect(check.body.quietReport.summary).toMatch(/Quiet on purpose/i);
    expect(check.body.quietReport.items[0].oldEvidence || check.body.quietReport.items[0].newEvidence).toBeTruthy();

    const detail = await request.get(`/api/monitors/${created.body.id}`).expect(200);
    expect(detail.body.lastCheckSummary).toBe('irrelevant_change');
    expect(detail.body.latestQuietReport).toBeTruthy();
    expect(detail.body.latestQuietReport.suppressedCount).toBeGreaterThan(0);

    await request.delete(`/api/monitors/${created.body.id}`).expect(200);
  });
});
