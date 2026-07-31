import { Router } from 'express';
import { z } from 'zod';
import { getDb, getSetting, setSetting } from '../db.js';
import { emailConfigured } from '../config.js';
import { getComparisonProvider } from '../lib/meaning.js';
import { createMonitor } from '../lib/monitorService.js';
import { LAB_PAGES, setActiveMutations } from '../lab/pages.js';
import { labPageUrl } from '../selfOrigin.js';
import { asyncHandler } from './helpers.js';
import type { MonitorRow } from '../types.js';

const router = Router();

/* ---- Dashboard summary ---- */
router.get('/stats', (_req, res) => {
  const db = getDb();
  const count = (sql: string): number => (db.prepare(sql).get() as { c: number }).c;
  res.json({
    activeMonitors: count("SELECT COUNT(*) as c FROM monitors WHERE status != 'paused'"),
    totalMonitors: count('SELECT COUNT(*) as c FROM monitors'),
    meaningfulChanges: count('SELECT COUNT(*) as c FROM changes WHERE meaningful = 1 AND intentMatched = 1'),
    unreadAlerts: count('SELECT COUNT(*) as c FROM notifications WHERE read = 0'),
    checksCompleted: count('SELECT COUNT(*) as c FROM snapshots'),
    attentionMonitors: count("SELECT COUNT(*) as c FROM monitors WHERE status IN ('blocked', 'uncertain', 'failed')"),
    falseAlertFeedback: count("SELECT COUNT(*) as c FROM changes WHERE feedback = 'irrelevant'")
  });
});

/* ---- Settings ---- */
router.get('/settings', (_req, res) => {
  res.json({
    defaultFrequency: getSetting('defaultFrequency', 'daily'),
    defaultRelevanceThreshold: Number(getSetting('defaultRelevanceThreshold', '0.55')),
    notificationsEnabled: getSetting('notificationsEnabled', 'true') === 'true',
    theme: getSetting('theme', 'system'),
    email: {
      configured: emailConfigured(),
      note: emailConfigured()
        ? 'SMTP is configured; alert emails will be sent.'
        : 'Email delivery is disabled. Configure SMTP_* variables in .env to enable it. In-app alerts always work.'
    },
    comparisonEngine: {
      name: getComparisonProvider().name,
      description: getComparisonProvider().description
    }
  });
});

router.put('/settings', (req, res) => {
  const body = z
    .object({
      defaultFrequency: z.enum(['15min', 'hourly', '6hours', 'daily', 'manual']).optional(),
      defaultRelevanceThreshold: z.number().min(0.2).max(0.9).optional(),
      notificationsEnabled: z.boolean().optional(),
      theme: z.enum(['light', 'dark', 'system']).optional()
    })
    .parse(req.body);
  if (body.defaultFrequency) setSetting('defaultFrequency', body.defaultFrequency);
  if (body.defaultRelevanceThreshold !== undefined) setSetting('defaultRelevanceThreshold', String(body.defaultRelevanceThreshold));
  if (body.notificationsEnabled !== undefined) setSetting('notificationsEnabled', String(body.notificationsEnabled));
  if (body.theme) setSetting('theme', body.theme);
  res.json({ ok: true });
});

/* ---- Data reset ---- */
router.post('/settings/reset-data', (_req, res) => {
  const db = getDb();
  db.exec('DELETE FROM notifications; DELETE FROM changes; DELETE FROM snapshots; DELETE FROM monitors; DELETE FROM evaluation_runs;');
  for (const page of LAB_PAGES) setActiveMutations(page.slug, []);
  res.json({ ok: true });
});

/* ---- Sample monitors (loaded intentionally by the user) ---- */
router.post(
  '/samples/load',
  asyncHandler(async (_req, res) => {
    const db = getDb();
    const created: MonitorRow[] = [];
    const samples = [
      {
        page: LAB_PAGES[0]!,
        name: 'Westfield transfer GPA',
        intent: 'Alert me if the minimum transfer GPA changes.'
      },
      {
        page: LAB_PAGES[1]!,
        name: 'Alpine jacket in XL',
        intent: 'Notify me when this jacket becomes available in XL.'
      },
      {
        page: LAB_PAGES[2]!,
        name: 'Cascade scholarship deadline',
        intent: 'Tell me if the scholarship application deadline moves.'
      }
    ];
    for (const sample of samples) {
      const url = labPageUrl(sample.page.slug);
      const exists = db.prepare('SELECT id FROM monitors WHERE url = ? AND userIntent = ?').get(url, sample.intent);
      if (exists) continue;
      setActiveMutations(sample.page.slug, []);
      created.push(
        await createMonitor({
          name: sample.name,
          url,
          userIntent: sample.intent,
          checkFrequency: 'manual'
        })
      );
    }
    res.json({ created: created.length });
  })
);

export default router;
