/**
 * Integration tests: the full monitor lifecycle against the app's own
 * Evaluation Lab pages — create, baseline, harmless mutation (no alert),
 * meaningful mutation (correct alert with evidence), feedback, version
 * comparison, deletion — plus the evaluation suite itself.
 *
 * Everything runs against an in-memory SQLite database and locally served
 * fixture pages; nothing touches the public internet.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import supertest from 'supertest';

process.env.PAGEPULSE_DB = ':memory:';
process.env.NODE_ENV = 'test';

const { createApp } = await import('../src/app.js');
const { setSelfOrigin } = await import('../src/selfOrigin.js');
const { runSuite } = await import('../src/lab/evalRunner.js');

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

describe('preview endpoint', () => {
  it('fetches and cleans a lab page, ranking sections for the intent', async () => {
    await request.post('/api/lab/pages/college-admissions/reset').expect(200);
    const res = await request
      .post('/api/preview')
      .send({ url: `${baseUrl()}/lab-pages/college-admissions`, userIntent: 'Alert me if the minimum transfer GPA changes.' })
      .expect(200);
    expect(res.body.fetch.status).toBe('ok');
    expect(res.body.page.title).toContain('Transfer Admissions');
    expect(res.body.page.sections.length).toBeGreaterThan(2);
    const top = res.body.page.sections[res.body.ranked[0].index];
    expect(top.heading).toContain('Requirement');
  });

  it('refuses private-network URLs with a clear error', async () => {
    const res = await request
      .post('/api/preview')
      .send({ url: 'http://192.168.1.1/admin', userIntent: 'Watch this page.' })
      .expect(200);
    expect(res.body.fetch.status).toBe('blocked');
    expect(res.body.fetch.details).toMatch(/private/i);
  });

  it('validates the request body', async () => {
    const res = await request.post('/api/preview').send({ url: '' }).expect(400);
    expect(res.body.error.message).toBeTruthy();
  });
});

function baseUrl(): string {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return `http://127.0.0.1:${port}`;
}

describe('monitor lifecycle end to end', () => {
  let monitorId: number;
  let baselineSnapshotId: number;
  let changedSnapshotId: number;
  let alertChangeId: number;

  it('creates a monitor with a baseline snapshot', async () => {
    await request.post('/api/lab/pages/college-admissions/reset').expect(200);
    const res = await request
      .post('/api/monitors')
      .send({
        name: 'GPA watch',
        url: `${baseUrl()}/lab-pages/college-admissions`,
        userIntent: 'Alert me if the minimum transfer GPA changes.',
        checkFrequency: 'manual'
      })
      .expect(201);
    monitorId = res.body.id;
    expect(res.body.selectedSectionHeading).toContain('Requirement');
    expect(res.body.status).toBe('healthy');
    expect(res.body.versionCount).toBe(1);

    const snaps = await request.get(`/api/monitors/${monitorId}/snapshots`).expect(200);
    baselineSnapshotId = snaps.body[0].id;
    expect(snaps.body[0].cleanedSectionText).toContain('3.20');
  });

  it('rejects monitors for unreachable/private pages', async () => {
    const res = await request
      .post('/api/monitors')
      .send({ name: 'x', url: 'http://127.0.0.1:1/x', userIntent: 'watch the price', checkFrequency: 'daily' })
      .expect(422);
    expect(res.body.error.message).toMatch(/cannot be monitored/i);
  });

  it('ignores a harmless rewording (no alert)', async () => {
    await request.post('/api/lab/pages/college-admissions/mutations').send({ mutations: ['reword-gpa', 'footer-year'] }).expect(200);
    const res = await request.post(`/api/monitors/${monitorId}/check`).expect(200);
    expect(res.body.alertsCreated).toBe(0);
    expect(res.body.status).toBe('healthy');
    const notifications = await request.get('/api/notifications').expect(200);
    expect(notifications.body.filter((n: { monitorId: number }) => n.monitorId === monitorId)).toHaveLength(0);
  });

  it('alerts on a meaningful GPA change with exact evidence', async () => {
    await request.post('/api/lab/pages/college-admissions/mutations').send({ mutations: ['gpa-increase'] }).expect(200);
    const res = await request.post(`/api/monitors/${monitorId}/check`).expect(200);
    expect(res.body.alertsCreated).toBeGreaterThan(0);
    expect(res.body.status).toBe('changed');
    changedSnapshotId = res.body.snapshotId;

    const alerting = res.body.changes.filter((c: { intentMatched: number }) => c.intentMatched === 1);
    expect(alerting.length).toBeGreaterThan(0);
    const change = alerting[0];
    alertChangeId = change.id;
    expect(change.oldValue).toContain('3.20');
    expect(change.newValue).toContain('3.40');
    expect(change.oldEvidence).toContain('3.20');
    expect(change.newEvidence).toContain('3.40');
    expect(change.category).toBe('requirement_tightened');
    expect(change.explanation.length).toBeGreaterThan(10);

    const notifications = await request.get('/api/notifications').expect(200);
    const mine = notifications.body.filter((n: { monitorId: number }) => n.monitorId === monitorId);
    expect(mine.length).toBe(1);
    expect(mine[0].title).toContain('3.40');
  });

  it('compares two versions with annotated changes', async () => {
    const res = await request
      .get(`/api/monitors/${monitorId}/compare?old=${baselineSnapshotId}&new=${changedSnapshotId}`)
      .expect(200);
    expect(res.body.oldSnapshot.cleanedSectionText).toContain('3.20');
    expect(res.body.newSnapshot.cleanedSectionText).toContain('3.40');
    const meaningful = res.body.changes.filter((c: { meaning: { meaningful: boolean } }) => c.meaning.meaningful);
    expect(meaningful.length).toBeGreaterThan(0);
  });

  it('records feedback and adjusts only that monitor threshold', async () => {
    const before = (await request.get(`/api/monitors/${monitorId}`).expect(200)).body.relevanceThreshold;
    await request.post(`/api/changes/${alertChangeId}/feedback`).send({ feedback: 'irrelevant' }).expect(200);
    const after = (await request.get(`/api/monitors/${monitorId}`).expect(200)).body.relevanceThreshold;
    expect(after).toBeCloseTo(before + 0.05, 5);
    await request.post(`/api/changes/${alertChangeId}/feedback`).send({ feedback: 'useful' }).expect(200);
  });

  it('marks notifications read/unread and dismisses them', async () => {
    const notifications = await request.get('/api/notifications').expect(200);
    const id = notifications.body[0].id;
    await request.post(`/api/notifications/${id}/read`).expect(200);
    let count = await request.get('/api/notifications/unread-count').expect(200);
    const afterRead = count.body.count;
    await request.post(`/api/notifications/${id}/unread`).expect(200);
    count = await request.get('/api/notifications/unread-count').expect(200);
    expect(count.body.count).toBe(afterRead + 1);
    await request.delete(`/api/notifications/${id}`).expect(200);
  });

  it('pauses, resumes, and deletes the monitor', async () => {
    const paused = await request.post(`/api/monitors/${monitorId}/pause`).expect(200);
    expect(paused.body.status).toBe('paused');
    const resumed = await request.post(`/api/monitors/${monitorId}/resume`).expect(200);
    expect(resumed.body.status).toBe('healthy');
    await request.delete(`/api/monitors/${monitorId}`).expect(200);
    await request.get(`/api/monitors/${monitorId}`).expect(404);
  });
});

describe('section tracking across page reorganization', () => {
  it('still tracks a renamed section and stays quiet when content is equivalent', async () => {
    await request.post('/api/lab/pages/college-admissions/reset').expect(200);
    const created = await request
      .post('/api/monitors')
      .send({
        name: 'Rename tracking',
        url: `${baseUrl()}/lab-pages/college-admissions`,
        userIntent: 'Alert me if the minimum transfer GPA changes.',
        checkFrequency: 'manual'
      })
      .expect(201);
    await request.post('/api/lab/pages/college-admissions/mutations').send({ mutations: ['heading-rename'] }).expect(200);
    const res = await request.post(`/api/monitors/${created.body.id}/check`).expect(200);
    expect(res.body.alertsCreated).toBe(0);
    const detail = await request.get(`/api/monitors/${created.body.id}`).expect(200);
    expect(detail.body.selectedSectionHeading).toBe('Requirements for Transfer Applicants');
    await request.delete(`/api/monitors/${created.body.id}`).expect(200);
  });
});

describe('transfer GPA workflow fixture', () => {
  const intent =
    'Alert me only if the minimum transferable GPA requirement changes. Ignore footer dates, formatting changes, rewording, and application deadlines.';

  it('runs baseline → reword → unrelated → meaningful → duplicate without duplicate alerts', async () => {
    await request.post('/api/lab/pages/transfer-gpa-workflow/reset').expect(200);

    const created = await request
      .post('/api/monitors')
      .send({
        name: 'Transfer GPA Requirement',
        url: `${baseUrl()}/lab-pages/transfer-gpa-workflow`,
        userIntent: intent,
        checkFrequency: 'manual',
        sectionHeading: 'Minimum GPA'
      })
      .expect(201);
    const id = created.body.id as number;
    expect(created.body.selectedSectionHeading).toBe('Minimum GPA');
    expect(created.body.selectedSectionText).toContain('3.20');

    const baselineSnaps = await request.get(`/api/monitors/${id}/snapshots`).expect(200);
    expect(baselineSnaps.body).toHaveLength(1);
    expect(baselineSnaps.body[0].extractedFacts.some((f: { value: string }) => f.value === '3.20')).toBe(true);

    await request.post('/api/lab/pages/transfer-gpa-workflow/mutations').send({ mutations: ['reword-gpa'] }).expect(200);
    const reword = await request.post(`/api/monitors/${id}/check`).expect(200);
    expect(reword.body.alertsCreated).toBe(0);
    expect(reword.body.status).toBe('healthy');
    const rewordChanges = (reword.body.changes as Array<{ meaningful: number; explanation: string }>).filter(
      (c) => c.explanation
    );
    expect(rewordChanges.some((c) => c.meaningful === 0 && /did not change/i.test(c.explanation))).toBe(true);

    await request
      .post('/api/lab/pages/transfer-gpa-workflow/mutations')
      .send({ mutations: ['reword-gpa', 'deadline-change', 'footer-year'] })
      .expect(200);
    const unrelated = await request.post(`/api/monitors/${id}/check`).expect(200);
    expect(unrelated.body.alertsCreated).toBe(0);
    expect(unrelated.body.status).toBe('healthy');

    await request.post('/api/lab/pages/transfer-gpa-workflow/mutations').send({ mutations: ['gpa-increase'] }).expect(200);
    const meaningful = await request.post(`/api/monitors/${id}/check`).expect(200);
    expect(meaningful.body.alertsCreated).toBe(1);
    expect(meaningful.body.status).toBe('changed');
    const alert = (meaningful.body.changes as Array<{
      intentMatched: number;
      oldValue: string;
      newValue: string;
      category: string;
      oldEvidence: string;
      newEvidence: string;
    }>).find((c) => c.intentMatched === 1)!;
    expect(alert.oldValue).toContain('3.20');
    expect(alert.newValue).toContain('3.40');
    expect(alert.oldEvidence).toContain('3.20');
    expect(alert.newEvidence).toContain('3.40');
    expect(alert.category).toBe('requirement_tightened');

    const notifs = await request.get('/api/notifications').expect(200);
    const mine = notifs.body.filter((n: { monitorId: number }) => n.monitorId === id);
    expect(mine).toHaveLength(1);
    expect(mine[0].title + mine[0].message).toMatch(/3\.40|stricter|increase|tightened/i);

    const duplicate = await request.post(`/api/monitors/${id}/check`).expect(200);
    expect(duplicate.body.alertsCreated).toBe(0);
    const notifsAfter = await request.get('/api/notifications').expect(200);
    expect(notifsAfter.body.filter((n: { monitorId: number }) => n.monitorId === id)).toHaveLength(1);

    const snaps = await request.get(`/api/monitors/${id}/snapshots`).expect(200);
    expect(snaps.body.length).toBeGreaterThanOrEqual(2);

    await request.delete(`/api/monitors/${id}`).expect(200);
  });
});

describe('evaluation suite', () => {
  it('runs every deterministic scenario correctly', async () => {
    const report = await runSuite();
    const failures = report.results.filter((r) => !r.correct);
    expect(failures, JSON.stringify(failures.map((f) => ({ id: f.scenarioId, actual: f.actual, details: f.details })), null, 2)).toHaveLength(0);
    expect(report.metrics.recall).toBe(1);
    expect(report.metrics.falseAlertRate).toBe(0);
    expect(report.metrics.sectionTrackingAccuracy).toBe(1);
    expect(report.metrics.evidenceAccuracy).toBe(1);
  }, 60_000);
});
