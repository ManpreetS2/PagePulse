/**
 * v1.1 guided demo + monitor health tests (in-memory DB, local lab pages).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import supertest from 'supertest';

process.env.PAGEPULSE_DB = ':memory:';
process.env.NODE_ENV = 'test';

const { createApp } = await import('../src/app.js');
const { setSelfOrigin } = await import('../src/selfOrigin.js');
const { deriveMonitorHealth } = await import('../src/lib/monitorHealth.js');
const { summarizeEvidenceFacts } = await import('../src/lib/evidenceSummary.js');

let server: Server;
let request: ReturnType<typeof supertest>;

beforeAll(async () => {
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
});

describe('monitor health derivation', () => {
  it('labels manual-only and due-soon monitors clearly', () => {
    expect(
      deriveMonitorHealth({
        status: 'healthy',
        checkFrequency: 'manual',
        nextCheckAt: null,
        lastCheckSummary: 'no_change',
        failureCount: 0,
        lastError: null
      }).displayStatus
    ).toBe('manual_only');

    const soon = new Date(Date.now() + 5 * 60_000).toISOString();
    expect(
      deriveMonitorHealth({
        status: 'healthy',
        checkFrequency: 'hourly',
        nextCheckAt: soon,
        lastCheckSummary: 'no_change',
        failureCount: 0,
        lastError: null
      }).displayStatus
    ).toBe('due_soon');
  });

  it('surfaces blocked, failed, and no-relevant-change states', () => {
    expect(
      deriveMonitorHealth({
        status: 'blocked',
        checkFrequency: 'daily',
        nextCheckAt: null,
        lastCheckSummary: 'blocked',
        failureCount: 2,
        lastError: 'Private network'
      }).label
    ).toMatch(/Blocked/i);

    expect(
      deriveMonitorHealth({
        status: 'healthy',
        checkFrequency: 'daily',
        nextCheckAt: new Date(Date.now() + 3_600_000).toISOString(),
        lastCheckSummary: 'irrelevant_change',
        failureCount: 0,
        lastError: null
      }).displayStatus
    ).toBe('no_relevant_change');
  });
});

describe('evidence fact summary', () => {
  it('separates confirmed, unchanged, and ignored changes', () => {
    const summary = summarizeEvidenceFacts(
      'Applicants must have a minimum transferable GPA of 3.20.',
      'Applicants must have a minimum transferable GPA of 3.40.',
      [
        {
          category: 'requirement_tightened',
          oldValue: '3.20',
          newValue: '3.40',
          meaning: { meaningful: true, explanation: 'GPA changed' },
          intentResult: { matched: true, reason: 'matched' }
        },
        {
          category: 'text_change',
          oldValue: 'a',
          newValue: 'b',
          meaning: { meaningful: false, explanation: 'reword' },
          intentResult: { matched: false, reason: 'unrelated' }
        }
      ]
    );
    expect(summary.confirmedChanged.some((f) => f.oldValue === '3.20' && f.newValue === '3.40')).toBe(true);
    expect(summary.ignoredUnrelated.length).toBeGreaterThan(0);
  });
});

describe('guided demo end to end', () => {
  it('runs baseline → reword → unrelated → meaningful → reset without duplicate alerts', async () => {
    await request.post('/api/demo/reset').expect(200);

    const started = await request.post('/api/demo/start').expect(201);
    expect(started.body.state.step).toBe('baseline');
    expect(started.body.monitor.selectedSectionHeading).toBe('Minimum GPA');
    expect(started.body.extractedGpa).toBe('3.20');
    expect(started.body.monitor.health.displayStatus).toMatch(/manual_only|healthy/);

    const reword = await request.post('/api/demo/continue').expect(200);
    expect(reword.body.state.step).toBe('reword');
    expect(reword.body.outcome.alertsCreated).toBe(0);
    expect(reword.body.extractedGpa).toBe('3.20');
    expect(reword.body.outcome.changes.some((c: { meaningful: number }) => c.meaningful === 0)).toBe(true);

    const unrelated = await request.post('/api/demo/continue').expect(200);
    expect(unrelated.body.state.step).toBe('unrelated');
    expect(unrelated.body.outcome.alertsCreated).toBe(0);

    const meaningful = await request.post('/api/demo/continue').expect(200);
    expect(meaningful.body.state.step).toBe('complete');
    expect(meaningful.body.outcome.alertsCreated).toBe(1);
    const alert = meaningful.body.outcome.changes.find((c: { intentMatched: number }) => c.intentMatched === 1);
    expect(alert.oldValue).toContain('3.20');
    expect(alert.newValue).toContain('3.40');
    expect(alert.oldEvidence).toContain('3.20');
    expect(alert.newEvidence).toContain('3.40');
    expect(alert.category).toBe('requirement_tightened');
    expect(meaningful.body.state.notificationId).toBeTruthy();

    const monitorId = meaningful.body.state.monitorId as number;
    const again = await request.post(`/api/monitors/${monitorId}/check`).expect(200);
    expect(again.body.alertsCreated).toBe(0);

    const notifs = await request.get('/api/notifications').expect(200);
    expect(notifs.body.filter((n: { monitorId: number }) => n.monitorId === monitorId)).toHaveLength(1);

    const compare = await request
      .get(`/api/monitors/${monitorId}/compare?old=${meaningful.body.state.baselineSnapshotId}&new=${meaningful.body.state.latestSnapshotId}`)
      .expect(200);
    expect(compare.body.factSummary).toBeTruthy();
    expect(compare.body.oldSnapshot.cleanedSectionText).toContain('3.20');
    expect(compare.body.newSnapshot.cleanedSectionText).toContain('3.40');

    const reset = await request.post('/api/demo/reset').expect(200);
    expect(reset.body.state.step).toBe('idle');
    expect(reset.body.monitor).toBeNull();
    await request.get(`/api/monitors/${monitorId}`).expect(404);
  });
});

describe('health endpoint and blocked preview messaging', () => {
  it('reports API health with version', async () => {
    const res = await request.get('/api/health').expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.version).toBe('1.1.1');
  });

  it('returns a clear blocked message for private URLs', async () => {
    const res = await request
      .post('/api/preview')
      .send({ url: 'http://10.0.0.8/internal', userIntent: 'watch the GPA' })
      .expect(200);
    expect(res.body.fetch.status).toBe('blocked');
    expect(res.body.fetch.details).toMatch(/private|internal/i);
  });
});
