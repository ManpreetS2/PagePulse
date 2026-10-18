/**
 * Second-pass API hardening: expensive-route rate limits, resume clears
 * lastError, concurrent check returns 409, evaluation input bounds.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import supertest from 'supertest';

process.env.PAGEPULSE_DB = ':memory:';
process.env.NODE_ENV = 'test';

const { createApp, isExpensiveApiRequest } = await import('../src/app.js');
const { setSelfOrigin } = await import('../src/selfOrigin.js');
const { getDb, closeDb } = await import('../src/db.js');
const { markMonitorCheckRunningForTests, clearMonitorCheckRunningForTests } = await import('../src/lib/checkRunner.js');

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

describe('isExpensiveApiRequest', () => {
  it('flags preview, check, evaluation, and demo mutations', () => {
    expect(isExpensiveApiRequest({ method: 'POST', path: '/preview' } as never)).toBe(true);
    expect(isExpensiveApiRequest({ method: 'POST', path: '/monitors/12/check' } as never)).toBe(true);
    expect(isExpensiveApiRequest({ method: 'POST', path: '/evaluation/run' } as never)).toBe(true);
    expect(isExpensiveApiRequest({ method: 'POST', path: '/demo/start' } as never)).toBe(true);
    expect(isExpensiveApiRequest({ method: 'GET', path: '/preview' } as never)).toBe(false);
    expect(isExpensiveApiRequest({ method: 'GET', path: '/monitors' } as never)).toBe(false);
  });
});

describe('health stays available under API pressure classification', () => {
  it('serves /api/health without requiring a rate-limit slot from expensive traffic', async () => {
    const res = await request.get('/api/health').expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.version).toBe('1.1.1');
  });
});

describe('resume clears stale lastError', () => {
  beforeEach(() => {
    getDb().prepare('DELETE FROM notifications').run();
    getDb().prepare('DELETE FROM changes').run();
    getDb().prepare('DELETE FROM snapshots').run();
    getDb().prepare('DELETE FROM monitors').run();
  });

  it('nulls lastError when a paused monitor is resumed', async () => {
    const created = await request
      .post('/api/monitors')
      .send({
        name: 'Resume clear',
        url: `${baseUrl()}/lab-pages/college-admissions`,
        userIntent: 'Alert me if the minimum transfer GPA changes.',
        checkFrequency: 'hourly'
      })
      .expect(201);

    getDb()
      .prepare(
        "UPDATE monitors SET status = 'paused', lastError = 'Previous fetch failed hard.', failureCount = 3, nextCheckAt = NULL WHERE id = ?"
      )
      .run(created.body.id);

    const resumed = await request.post(`/api/monitors/${created.body.id}/resume`).expect(200);
    expect(resumed.body.status).toBe('healthy');
    expect(resumed.body.lastError).toBeNull();
    expect(resumed.body.failureCount).toBe(0);
  });
});

describe('concurrent check conflict', () => {
  beforeEach(() => {
    getDb().prepare('DELETE FROM notifications').run();
    getDb().prepare('DELETE FROM changes').run();
    getDb().prepare('DELETE FROM snapshots').run();
    getDb().prepare('DELETE FROM monitors').run();
  });

  it('returns 409 when a check is already running for the monitor', async () => {
    const created = await request
      .post('/api/monitors')
      .send({
        name: 'Busy check',
        url: `${baseUrl()}/lab-pages/college-admissions`,
        userIntent: 'Alert me if the minimum transfer GPA changes.',
        checkFrequency: 'manual'
      })
      .expect(201);

    markMonitorCheckRunningForTests(created.body.id);
    try {
      const res = await request.post(`/api/monitors/${created.body.id}/check`).expect(409);
      expect(res.body.error.message).toMatch(/already running/i);
    } finally {
      clearMonitorCheckRunningForTests(created.body.id);
    }
  });
});

describe('evaluation input bounds', () => {
  it('rejects oversized scenarioId lists', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `scenario-${i}`);
    const res = await request.post('/api/evaluation/run').send({ scenarioIds: ids }).expect(400);
    expect(res.body.error.message).toMatch(/Invalid request/i);
  });
});

describe('expensive endpoint rate limit', () => {
  it('returns 429 after the expensive-route budget is exhausted', async () => {
    let saw429 = false;
    for (let i = 0; i < 45; i++) {
      const res = await request.post('/api/preview').send({ url: 'http://127.0.0.1/', userIntent: 'watch the gpa' });
      if (res.status === 429) {
        saw429 = true;
        expect(res.body.error.message).toMatch(/Too many requests/i);
        break;
      }
      expect([200, 400]).toContain(res.status);
    }
    expect(saw429).toBe(true);
  });
});
