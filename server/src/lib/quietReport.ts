/**
 * Evidence-backed summary of changes that were detected but did not alert.
 * Used by the check runner (API response) and monitor serialization (detail UI).
 */
import type { ChangeRow } from '../types.js';

export interface QuietReportItem {
  category: string;
  oldValue: string;
  newValue: string;
  oldEvidence: string;
  newEvidence: string;
  reason: string;
  meaningful: boolean;
  intentMatched: boolean;
}

export interface QuietReport {
  summary: string;
  suppressedCount: number;
  items: QuietReportItem[];
}

export function buildQuietReport(changes: ChangeRow[]): QuietReport | null {
  const suppressed = changes.filter((c) => !(c.meaningful && c.intentMatched));
  if (suppressed.length === 0) return null;
  const items: QuietReportItem[] = suppressed.slice(0, 8).map((c) => ({
    category: c.category,
    oldValue: c.oldValue,
    newValue: c.newValue,
    oldEvidence: c.oldEvidence,
    newEvidence: c.newEvidence,
    reason: c.meaningful
      ? c.explanation || 'Detected as meaningful, but it did not match your monitoring instruction.'
      : c.explanation || 'Judged not meaningful (cosmetic or unrelated noise).',
    meaningful: Boolean(c.meaningful),
    intentMatched: Boolean(c.intentMatched)
  }));
  const cosmetic = items.filter((i) => !i.meaningful).length;
  const intentMiss = items.filter((i) => i.meaningful && !i.intentMatched).length;
  const parts: string[] = [];
  if (cosmetic) parts.push(`${cosmetic} cosmetic/noise`);
  if (intentMiss) parts.push(`${intentMiss} meaningful but off-intent`);
  return {
    summary: `Quiet on purpose: ${suppressed.length} change${suppressed.length === 1 ? '' : 's'} recorded (${parts.join(', ') || 'filtered'}), none matched your instruction closely enough to alert.`,
    suppressedCount: suppressed.length,
    items
  };
}
