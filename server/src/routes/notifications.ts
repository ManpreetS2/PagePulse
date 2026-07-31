import { Router } from 'express';
import { getDb } from '../db.js';
import type { ChangeRow, NotificationRow } from '../types.js';
import { HttpError } from './helpers.js';

const router = Router();

const idParam = (raw: string): number => {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid id.');
  return id;
};

router.get('/notifications', (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT n.*, m.name as monitorName, m.url as monitorUrl, m.userIntent as monitorIntent
       FROM notifications n JOIN monitors m ON m.id = n.monitorId
       ORDER BY n.id DESC LIMIT 200`
    )
    .all() as Array<NotificationRow & { monitorName: string; monitorUrl: string; monitorIntent: string }>;
  const changeIds = rows.map((r) => r.changeId).filter((x): x is number => x !== null);
  const changes = changeIds.length
    ? (db
        .prepare(`SELECT * FROM changes WHERE id IN (${changeIds.map(() => '?').join(',')})`)
        .all(...changeIds) as ChangeRow[])
    : [];
  const changeById = new Map(changes.map((c) => [c.id, c]));
  res.json(rows.map((r) => ({ ...r, change: r.changeId ? changeById.get(r.changeId) ?? null : null })));
});

router.get('/notifications/unread-count', (_req, res) => {
  const row = getDb().prepare('SELECT COUNT(*) as c FROM notifications WHERE read = 0').get() as { c: number };
  res.json({ count: row.c });
});

router.post('/notifications/:id/read', (req, res) => {
  getDb().prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(idParam(req.params.id!));
  res.json({ ok: true });
});

router.post('/notifications/:id/unread', (req, res) => {
  getDb().prepare('UPDATE notifications SET read = 0 WHERE id = ?').run(idParam(req.params.id!));
  res.json({ ok: true });
});

router.post('/notifications/read-all', (_req, res) => {
  getDb().prepare('UPDATE notifications SET read = 1').run();
  res.json({ ok: true });
});

router.delete('/notifications/:id', (req, res) => {
  getDb().prepare('DELETE FROM notifications WHERE id = ?').run(idParam(req.params.id!));
  res.json({ ok: true });
});

export default router;
