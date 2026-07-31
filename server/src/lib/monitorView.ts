/**
 * Shared monitor serialization for API responses (list, detail, guided demo).
 */
import { getDb } from '../db.js';
import type { MonitorRow, SnapshotRow } from '../types.js';
import { parseIntent } from './intent.js';
import { deriveMonitorHealth } from './monitorHealth.js';
import { safeJson } from '../routes/helpers.js';

export function monitorWithExtras(m: MonitorRow) {
  const db = getDb();
  const versions = db.prepare('SELECT COUNT(*) as c FROM snapshots WHERE monitorId = ?').get(m.id) as { c: number };
  const meaningfulChanges = db
    .prepare('SELECT COUNT(*) as c FROM changes WHERE monitorId = ? AND meaningful = 1 AND intentMatched = 1')
    .get(m.id) as { c: number };
  const unread = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE monitorId = ? AND read = 0').get(m.id) as { c: number };
  const latest = db
    .prepare(
      "SELECT extractedFacts, sectionMatchConfidence, sectionHeading, retrievalTime FROM snapshots WHERE monitorId = ? AND fetchStatus = 'ok' ORDER BY id DESC LIMIT 1"
    )
    .get(m.id) as
    | (Pick<SnapshotRow, 'extractedFacts' | 'sectionMatchConfidence' | 'sectionHeading'> & { retrievalTime: string })
    | undefined;
  const facts = safeJson(latest?.extractedFacts ?? '[]', [] as Array<{ type: string; value: string; context: string | null; raw: string }>);
  const health = deriveMonitorHealth({
    status: m.status,
    checkFrequency: m.checkFrequency,
    nextCheckAt: m.nextCheckAt,
    lastCheckSummary: m.lastCheckSummary ?? 'never',
    failureCount: m.failureCount,
    lastError: m.lastError
  });
  const latestValue =
    facts.length > 0
      ? facts
          .slice(0, 3)
          .map((f) => (f.type === 'availability' && f.context ? `${f.context}: ${f.value}` : f.raw || f.value))
          .join(' · ')
      : m.extractedTargetDescription;
  return {
    ...m,
    intent: safeJson(m.intentJson, parseIntent(m.userIntent)),
    versionCount: versions.c,
    meaningfulChangeCount: meaningfulChanges.c,
    unreadCount: unread.c,
    confidence: latest?.sectionMatchConfidence ?? 1,
    currentSummary: latestValue || m.extractedTargetDescription,
    health,
    lastFetchDurationMs: m.lastFetchDurationMs ?? null,
    monitoredSection: latest?.sectionHeading || m.selectedSectionHeading,
    latestExtractedValue: latestValue || null,
    lastSuccessfulCheckAt: latest?.retrievalTime ?? m.lastCheckedAt
  };
}
