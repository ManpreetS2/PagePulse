import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db.js';
import type { ChangeRow, MonitorRow, SnapshotRow } from '../types.js';
import { createMonitor, MonitorCreationError, previewUrl, applyOverrides } from '../lib/monitorService.js';
import { runCheck, computeNextCheck } from '../lib/checkRunner.js';
import { diffSectionText } from '../lib/diffEngine.js';
import { getComparisonProvider } from '../lib/meaning.js';
import { matchIntent, parseIntent } from '../lib/intent.js';
import { safeJson, asyncHandler, HttpError } from './helpers.js';

const router = Router();

const frequencySchema = z.enum(['15min', 'hourly', '6hours', 'daily', 'manual']);
const targetTypeSchema = z.enum(['deadline', 'requirement', 'price', 'availability', 'schedule', 'location', 'policy', 'contact', 'eligibility', 'general']);
const triggerSchema = z.enum(['any_change', 'increase', 'decrease', 'becomes_available', 'becomes_unavailable', 'moves_earlier', 'moves_later']);

const intentOverridesSchema = z
  .object({
    field: targetTypeSchema.optional(),
    variant: z.string().trim().max(60).nullable().optional(),
    trigger: triggerSchema.optional(),
    subject: z.string().trim().max(200).optional(),
    keywords: z.array(z.string().trim().min(1).max(40)).max(20).optional()
  })
  .optional();

const previewSchema = z.object({
  url: z.string().trim().min(1).max(2000),
  userIntent: z.string().trim().min(3).max(500)
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  url: z.string().trim().min(1).max(2000),
  userIntent: z.string().trim().min(3).max(500),
  checkFrequency: frequencySchema,
  sectionHeading: z.string().max(300).optional(),
  sectionIndex: z.number().int().min(0).max(500).optional(),
  relevanceThreshold: z.number().min(0.2).max(0.9).optional(),
  intentOverrides: intentOverridesSchema
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  userIntent: z.string().trim().min(3).max(500).optional(),
  checkFrequency: frequencySchema.optional(),
  relevanceThreshold: z.number().min(0.2).max(0.9).optional(),
  intentOverrides: intentOverridesSchema
});

function monitorWithExtras(m: MonitorRow) {
  const db = getDb();
  const versions = db.prepare('SELECT COUNT(*) as c FROM snapshots WHERE monitorId = ?').get(m.id) as { c: number };
  const meaningfulChanges = db
    .prepare('SELECT COUNT(*) as c FROM changes WHERE monitorId = ? AND meaningful = 1 AND intentMatched = 1')
    .get(m.id) as { c: number };
  const unread = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE monitorId = ? AND read = 0').get(m.id) as { c: number };
  const latest = db
    .prepare("SELECT extractedFacts, sectionMatchConfidence, sectionHeading FROM snapshots WHERE monitorId = ? AND fetchStatus = 'ok' ORDER BY id DESC LIMIT 1")
    .get(m.id) as Pick<SnapshotRow, 'extractedFacts' | 'sectionMatchConfidence' | 'sectionHeading'> | undefined;
  return {
    ...m,
    intent: safeJson(m.intentJson, parseIntent(m.userIntent)),
    versionCount: versions.c,
    meaningfulChangeCount: meaningfulChanges.c,
    unreadCount: unread.c,
    confidence: latest?.sectionMatchConfidence ?? 1,
    currentSummary: m.extractedTargetDescription
  };
}

function requireMonitor(id: number): MonitorRow {
  const m = getDb().prepare('SELECT * FROM monitors WHERE id = ?').get(id) as MonitorRow | undefined;
  if (!m) throw new HttpError(404, 'Monitor not found.');
  return m;
}

const idParam = (raw: string): number => {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid id.');
  return id;
};

/* ---- Preview (wizard steps 2-3) ---- */
router.post(
  '/preview',
  asyncHandler(async (req, res) => {
    const body = previewSchema.parse(req.body);
    const result = await previewUrl(body.url, body.userIntent);
    res.json(result);
  })
);

/* ---- CRUD ---- */
router.get('/monitors', (_req, res) => {
  const rows = getDb().prepare('SELECT * FROM monitors ORDER BY createdAt DESC').all() as MonitorRow[];
  res.json(rows.map(monitorWithExtras));
});

router.post(
  '/monitors',
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    try {
      const monitor = await createMonitor(body);
      res.status(201).json(monitorWithExtras(monitor));
    } catch (err) {
      if (err instanceof MonitorCreationError) throw new HttpError(422, err.message, { fetchStatus: err.fetchStatus });
      throw err;
    }
  })
);

router.get('/monitors/:id', (req, res) => {
  const monitor = requireMonitor(idParam(req.params.id!));
  const latest = getDb()
    .prepare('SELECT * FROM snapshots WHERE monitorId = ? ORDER BY id DESC LIMIT 1')
    .get(monitor.id) as SnapshotRow | undefined;
  res.json({
    ...monitorWithExtras(monitor),
    latestSnapshot: latest ? { ...latest, extractedFacts: safeJson(latest.extractedFacts, []) } : null
  });
});

router.patch(
  '/monitors/:id',
  asyncHandler(async (req, res) => {
    const monitor = requireMonitor(idParam(req.params.id!));
    const body = updateSchema.parse(req.body);
    const db = getDb();
    const fields: Record<string, string | number | null> = {};
    if (body.name) fields.name = body.name;
    if (body.checkFrequency) {
      fields.checkFrequency = body.checkFrequency;
      fields.nextCheckAt = monitor.status === 'paused' ? null : computeNextCheck(body.checkFrequency);
    }
    if (body.relevanceThreshold !== undefined) fields.relevanceThreshold = body.relevanceThreshold;
    if (body.userIntent || body.intentOverrides) {
      const raw = body.userIntent ?? monitor.userIntent;
      const intent = applyOverrides(parseIntent(raw), body.intentOverrides);
      fields.userIntent = raw;
      fields.intentJson = JSON.stringify(intent);
      fields.extractedTargetType = intent.field;
    }
    if (Object.keys(fields).length > 0) {
      const keys = Object.keys(fields);
      db.prepare(`UPDATE monitors SET ${keys.map((k) => `${k} = ?`).join(', ')}, updatedAt = datetime('now') WHERE id = ?`).run(
        ...keys.map((k) => fields[k] ?? null),
        monitor.id
      );
    }
    res.json(monitorWithExtras(requireMonitor(monitor.id)));
  })
);

router.delete('/monitors/:id', (req, res) => {
  const monitor = requireMonitor(idParam(req.params.id!));
  getDb().prepare('DELETE FROM monitors WHERE id = ?').run(monitor.id);
  res.json({ deleted: true });
});

/* ---- Actions ---- */
router.post(
  '/monitors/:id/check',
  asyncHandler(async (req, res) => {
    const monitor = requireMonitor(idParam(req.params.id!));
    const outcome = await runCheck(monitor.id);
    res.json({ ...outcome, monitor: monitorWithExtras(requireMonitor(monitor.id)) });
  })
);

router.post('/monitors/:id/pause', (req, res) => {
  const monitor = requireMonitor(idParam(req.params.id!));
  getDb()
    .prepare("UPDATE monitors SET pausedBeforeFailure = status, status = 'paused', nextCheckAt = NULL, updatedAt = datetime('now') WHERE id = ?")
    .run(monitor.id);
  res.json(monitorWithExtras(requireMonitor(monitor.id)));
});

router.post('/monitors/:id/resume', (req, res) => {
  const monitor = requireMonitor(idParam(req.params.id!));
  getDb()
    .prepare("UPDATE monitors SET status = 'healthy', failureCount = 0, nextCheckAt = ?, updatedAt = datetime('now') WHERE id = ?")
    .run(computeNextCheck(monitor.checkFrequency), monitor.id);
  res.json(monitorWithExtras(requireMonitor(monitor.id)));
});

/* ---- Version history + comparison ---- */
router.get('/monitors/:id/snapshots', (req, res) => {
  const monitor = requireMonitor(idParam(req.params.id!));
  const snapshots = getDb()
    .prepare('SELECT * FROM snapshots WHERE monitorId = ? ORDER BY id DESC LIMIT 200')
    .all(monitor.id) as SnapshotRow[];
  const changesBySnapshot = getDb()
    .prepare('SELECT newSnapshotId, COUNT(*) as total, SUM(meaningful) as meaningful, SUM(intentMatched) as alerts FROM changes WHERE monitorId = ? GROUP BY newSnapshotId')
    .all(monitor.id) as Array<{ newSnapshotId: number; total: number; meaningful: number; alerts: number }>;
  const byId = new Map(changesBySnapshot.map((c) => [c.newSnapshotId, c]));
  res.json(
    snapshots.map((s) => ({
      ...s,
      extractedFacts: safeJson(s.extractedFacts, []),
      changeSummary: byId.get(s.id) ?? { total: 0, meaningful: 0, alerts: 0 }
    }))
  );
});

router.get(
  '/monitors/:id/compare',
  asyncHandler(async (req, res) => {
    const monitor = requireMonitor(idParam(req.params.id!));
    const oldId = idParam(String(req.query.old ?? ''));
    const newId = idParam(String(req.query.new ?? ''));
    const db = getDb();
    const oldSnap = db.prepare('SELECT * FROM snapshots WHERE id = ? AND monitorId = ?').get(oldId, monitor.id) as SnapshotRow | undefined;
    const newSnap = db.prepare('SELECT * FROM snapshots WHERE id = ? AND monitorId = ?').get(newId, monitor.id) as SnapshotRow | undefined;
    if (!oldSnap || !newSnap) throw new HttpError(404, 'One of the requested versions was not found for this monitor.');

    const intent = safeJson(monitor.intentJson, parseIntent(monitor.userIntent));
    const detected = diffSectionText(oldSnap.cleanedSectionText, newSnap.cleanedSectionText);
    const provider = getComparisonProvider();
    const annotated = [];
    for (const change of detected) {
      const meaning = await provider.compare({ change, intent, sectionHeading: newSnap.sectionHeading });
      const intentResult = matchIntent(change, intent, newSnap.sectionHeading);
      annotated.push({ ...change, meaning, intentResult });
    }
    res.json({
      monitor: { id: monitor.id, name: monitor.name, userIntent: monitor.userIntent },
      oldSnapshot: { ...oldSnap, extractedFacts: safeJson(oldSnap.extractedFacts, []) },
      newSnapshot: { ...newSnap, extractedFacts: safeJson(newSnap.extractedFacts, []) },
      changes: annotated
    });
  })
);

/* ---- Changes + feedback ---- */
router.get('/monitors/:id/changes', (req, res) => {
  const monitor = requireMonitor(idParam(req.params.id!));
  const rows = getDb()
    .prepare('SELECT * FROM changes WHERE monitorId = ? ORDER BY id DESC LIMIT 200')
    .all(monitor.id) as ChangeRow[];
  res.json(rows);
});

router.post('/changes/:id/feedback', (req, res) => {
  const id = idParam(req.params.id!);
  const body = z.object({ feedback: z.enum(['useful', 'irrelevant']).nullable() }).parse(req.body);
  const db = getDb();
  const change = db.prepare('SELECT * FROM changes WHERE id = ?').get(id) as ChangeRow | undefined;
  if (!change) throw new HttpError(404, 'Change not found.');
  db.prepare('UPDATE changes SET feedback = ? WHERE id = ?').run(body.feedback, id);

  // Feedback tunes only this monitor's relevance threshold — no hidden profile.
  const monitor = db.prepare('SELECT relevanceThreshold FROM monitors WHERE id = ?').get(change.monitorId) as
    | { relevanceThreshold: number }
    | undefined;
  if (monitor && body.feedback) {
    const next =
      body.feedback === 'irrelevant'
        ? Math.min(0.9, monitor.relevanceThreshold + 0.05)
        : Math.max(0.3, monitor.relevanceThreshold - 0.02);
    db.prepare("UPDATE monitors SET relevanceThreshold = ?, updatedAt = datetime('now') WHERE id = ?").run(next, change.monitorId);
  }
  res.json({ ok: true, feedback: body.feedback });
});

export default router;
