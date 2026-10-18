/**
 * Check runner: the end-to-end pipeline for a single monitor check.
 *
 * fetch → clean → match section → snapshot → diff → meaning → intent →
 * alert. Also maintains monitor status, failure counts, and next-check
 * scheduling. A per-process lock prevents the same monitor from being
 * checked twice concurrently.
 */
import { getDb } from '../db.js';
import { config } from '../config.js';
import type { ChangeRow, CheckFrequency, Fact, MonitorRow, ParsedIntent, SnapshotRow } from '../types.js';
import { fetchPage } from './fetcher.js';
import { cleanPage } from './cleaner.js';
import { extractFacts, summarizeFacts } from './extract.js';
import { matchSectionToBaseline, SECTION_MATCH_MIN_CONFIDENCE } from './sectionMatch.js';
import { diffSectionText } from './diffEngine.js';
import { getComparisonProvider } from './meaning.js';
import { matchIntent, parseIntent } from './intent.js';
import { sha256 } from './textUtils.js';
import { createNotification } from './notify.js';
import { buildQuietReport, type QuietReport } from './quietReport.js';

export type { QuietReport, QuietReportItem } from './quietReport.js';

const runningMonitors = new Set<number>();

/** True while runCheck is in flight for this monitor in the current process. */
export function isMonitorCheckRunning(monitorId: number): boolean {
  return runningMonitors.has(monitorId);
}

/** Test-only: mark a monitor as running so recovery can be asserted against it. */
export function markMonitorCheckRunningForTests(monitorId: number): void {
  runningMonitors.add(monitorId);
}

/** Test-only: clear the in-memory running flag. */
export function clearMonitorCheckRunningForTests(monitorId: number): void {
  runningMonitors.delete(monitorId);
}

export const FREQUENCY_MINUTES: Record<CheckFrequency, number | null> = {
  '15min': 15,
  hourly: 60,
  '6hours': 360,
  daily: 1440,
  manual: null
};

export function computeNextCheck(frequency: CheckFrequency, from = new Date()): string | null {
  const minutes = FREQUENCY_MINUTES[frequency];
  if (minutes === null) return null;
  return new Date(from.getTime() + minutes * 60_000).toISOString();
}

export interface CheckOutcome {
  status: MonitorRow['status'];
  snapshotId: number | null;
  changes: ChangeRow[];
  alertsCreated: number;
  message: string;
  /** Present when the check found page changes but created no alerts. */
  quietReport: QuietReport | null;
}

function emptyOutcome(
  status: MonitorRow['status'],
  message: string,
  extras: Partial<Pick<CheckOutcome, 'snapshotId' | 'changes' | 'alertsCreated' | 'quietReport'>> = {}
): CheckOutcome {
  return {
    status,
    snapshotId: extras.snapshotId ?? null,
    changes: extras.changes ?? [],
    alertsCreated: extras.alertsCreated ?? 0,
    message,
    quietReport: extras.quietReport ?? null
  };
}

function parseIntentJson(monitor: MonitorRow): ParsedIntent {
  try {
    const parsed = JSON.parse(monitor.intentJson) as ParsedIntent;
    if (parsed && parsed.raw) return parsed;
  } catch {
    /* fall through */
  }
  return parseIntent(monitor.userIntent);
}

function lastGoodSnapshot(monitorId: number): SnapshotRow | undefined {
  return getDb()
    .prepare("SELECT * FROM snapshots WHERE monitorId = ? AND fetchStatus = 'ok' ORDER BY id DESC LIMIT 1")
    .get(monitorId) as SnapshotRow | undefined;
}

function saveSnapshot(s: Omit<SnapshotRow, 'id' | 'retrievalTime'>): number {
  const result = getDb()
    .prepare(
      `INSERT INTO snapshots (monitorId, retrievalTime, pageTitle, finalUrl, sectionHeading, cleanedSectionText,
        normalizedText, extractedFacts, contentHash, fetchStatus, fetchDetails, sectionMatchConfidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      s.monitorId,
      new Date().toISOString(),
      s.pageTitle,
      s.finalUrl,
      s.sectionHeading,
      s.cleanedSectionText,
      s.normalizedText,
      s.extractedFacts,
      s.contentHash,
      s.fetchStatus,
      s.fetchDetails,
      s.sectionMatchConfidence
    );
  return Number(result.lastInsertRowid);
}

function updateMonitor(id: number, fields: Record<string, string | number | null>): void {
  const keys = Object.keys(fields);
  const sql = `UPDATE monitors SET ${keys.map((k) => `${k} = ?`).join(', ')}, updatedAt = datetime('now') WHERE id = ?`;
  getDb().prepare(sql).run(...keys.map((k) => fields[k] ?? null), id);
}

/**
 * Run a full check for one monitor. Returns the outcome; never throws for
 * expected failures (they are recorded on the monitor instead).
 */
export async function runCheck(monitorId: number): Promise<CheckOutcome> {
  const db = getDb();
  const monitor = db.prepare('SELECT * FROM monitors WHERE id = ?').get(monitorId) as MonitorRow | undefined;
  if (!monitor) return emptyOutcome('failed', 'Monitor not found.');

  if (runningMonitors.has(monitorId)) {
    return emptyOutcome(monitor.status, 'A check is already running for this monitor.');
  }
  runningMonitors.add(monitorId);
  const wasPaused = monitor.status === 'paused';
  const startedAt = Date.now();
  try {
    updateMonitor(monitorId, { status: 'checking' });

    // ---- Fetch (with limited retries for transient failures) ----
    let fetchResult = await fetchPage(monitor.url);
    for (let attempt = 0; attempt < config.scheduler.retriesPerCheck; attempt++) {
      if (fetchResult.status !== 'network_error' && fetchResult.status !== 'timeout') break;
      await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
      fetchResult = await fetchPage(monitor.url);
    }

    const now = new Date().toISOString();
    const nextCheckAt = computeNextCheck(monitor.checkFrequency);
    const durationMs = Date.now() - startedAt;

    if (fetchResult.status !== 'ok') {
      const failureCount = monitor.failureCount + 1;
      const isBlocked = fetchResult.status === 'blocked' || fetchResult.status === 'unsupported';
      const shouldPause = failureCount >= config.scheduler.maxConsecutiveFailuresBeforePause;
      const status = shouldPause ? 'paused' : isBlocked ? 'blocked' : 'failed';
      const snapshotId = saveSnapshot({
        monitorId,
        pageTitle: '',
        finalUrl: fetchResult.finalUrl,
        sectionHeading: monitor.selectedSectionHeading,
        cleanedSectionText: '',
        normalizedText: '',
        extractedFacts: '[]',
        contentHash: '',
        fetchStatus: fetchResult.status,
        fetchDetails: fetchResult.details,
        sectionMatchConfidence: 0
      });
      updateMonitor(monitorId, {
        status,
        failureCount,
        lastCheckedAt: now,
        nextCheckAt: shouldPause ? null : nextCheckAt,
        lastError: fetchResult.details,
        lastFetchDurationMs: durationMs,
        lastCheckSummary: isBlocked ? 'blocked' : 'failed'
      });
      if (failureCount === 1 || shouldPause) {
        createNotification(
          monitorId,
          null,
          shouldPause ? `Monitor paused after repeated failures: ${monitor.name}` : `Check failed: ${monitor.name}`,
          `${fetchResult.details}${shouldPause ? ` The monitor was paused after ${failureCount} consecutive failures. Resume it once the page is reachable.` : ''}`
        );
      }
      return emptyOutcome(status, fetchResult.details, { snapshotId });
    }

    // ---- Clean + match section ----
    const cleaned = cleanPage(fetchResult.html, fetchResult.finalUrl);
    const intent = parseIntentJson(monitor);
    const previous = lastGoodSnapshot(monitorId);
    const baselineFacts: Fact[] = previous ? safeParseFacts(previous.extractedFacts) : [];

    const match = matchSectionToBaseline(cleaned.sections, {
      heading: monitor.selectedSectionHeading,
      text: previous?.cleanedSectionText || monitor.selectedSectionText,
      facts: baselineFacts,
      intent
    });

    if (!match || cleaned.sections.length === 0) {
      updateMonitor(monitorId, {
        status: 'uncertain',
        failureCount: 0,
        lastCheckedAt: now,
        nextCheckAt,
        lastError: 'No readable sections were found on the page.',
        lastFetchDurationMs: durationMs,
        lastCheckSummary: 'uncertain'
      });
      const snapshotId = saveSnapshot({
        monitorId,
        pageTitle: cleaned.title,
        finalUrl: fetchResult.finalUrl,
        sectionHeading: '',
        cleanedSectionText: '',
        normalizedText: '',
        extractedFacts: '[]',
        contentHash: sha256(cleaned.fullText),
        fetchStatus: 'ok',
        fetchDetails: 'Page fetched, but no readable sections were found.',
        sectionMatchConfidence: 0
      });
      createNotification(monitorId, null, `Needs review: ${monitor.name}`, 'The page was fetched but PagePulse could not find readable sections to compare. Review the monitor.');
      return emptyOutcome('uncertain', 'No readable sections found.', { snapshotId });
    }

    const sectionText = match.section.text;
    const facts = extractFacts(sectionText);
    const contentHash = sha256(`${match.section.heading}\n${sectionText}`);
    const snapshotId = saveSnapshot({
      monitorId,
      pageTitle: cleaned.title,
      finalUrl: fetchResult.finalUrl,
      sectionHeading: match.section.heading,
      cleanedSectionText: sectionText,
      normalizedText: sectionText.toLowerCase(),
      extractedFacts: JSON.stringify(facts),
      contentHash,
      fetchStatus: 'ok',
      fetchDetails: `${fetchResult.details} Section match: ${match.reason}.`,
      sectionMatchConfidence: match.confidence
    });

    // ---- Low-confidence section match → uncertain, no confident alerts ----
    if (match.confidence < SECTION_MATCH_MIN_CONFIDENCE) {
      updateMonitor(monitorId, {
        status: 'uncertain',
        failureCount: 0,
        lastCheckedAt: now,
        nextCheckAt,
        lastError: `Could not confidently find the monitored section (best guess: “${match.section.heading}”, confidence ${(match.confidence * 100).toFixed(0)}%).`,
        lastFetchDurationMs: durationMs,
        lastCheckSummary: 'uncertain'
      });
      createNotification(
        monitorId,
        null,
        `Needs review: ${monitor.name}`,
        `PagePulse could not confidently locate the monitored section “${monitor.selectedSectionHeading}” on the page anymore (best candidate: “${match.section.heading}”, confidence ${(match.confidence * 100).toFixed(0)}%). Review the monitor and re-select the section if the page was reorganized.`
      );
      return emptyOutcome('uncertain', 'Section match confidence too low; monitor marked uncertain.', { snapshotId });
    }

    // ---- First check ever (baseline just saved at creation) ----
    if (!previous) {
      updateMonitor(monitorId, {
        status: 'healthy',
        failureCount: 0,
        lastCheckedAt: now,
        nextCheckAt,
        lastError: null,
        selectedSectionHeading: match.section.heading,
        selectedSectionText: sectionText,
        lastFetchDurationMs: durationMs,
        lastCheckSummary: 'baseline'
      });
      return emptyOutcome('healthy', 'Baseline saved.', { snapshotId });
    }

    // ---- Nothing changed at all ----
    if (previous.contentHash === contentHash) {
      updateMonitor(monitorId, {
        status: wasPaused ? 'paused' : 'healthy',
        failureCount: 0,
        lastCheckedAt: now,
        nextCheckAt,
        lastError: null,
        lastFetchDurationMs: durationMs,
        lastCheckSummary: 'no_change'
      });
      return emptyOutcome('healthy', 'No changes detected.', { snapshotId });
    }

    // ---- Diff + meaning + intent ----
    const detected = diffSectionText(previous.cleanedSectionText, sectionText);
    const provider = getComparisonProvider();
    const savedChanges: ChangeRow[] = [];
    let alertsCreated = 0;
    // The same value change can appear in several places (a sentence and a
    // table row). Alert once per unique (category, old, new) triple.
    const notified = new Set<string>();

    for (const change of detected) {
      const meaning = await provider.compare({ change, intent, sectionHeading: match.section.heading });
      const intentResult = matchIntent(change, intent, match.section.heading);
      const qualifies = meaning.meaningful && intentResult.matched && intentResult.confidence >= monitor.relevanceThreshold - 0.15;

      const explanation = `${meaning.explanation} ${intentResult.reason}`;
      const result = db
        .prepare(
          `INSERT INTO changes (monitorId, oldSnapshotId, newSnapshotId, category, oldValue, newValue, oldEvidence,
            newEvidence, sectionHeading, meaningful, intentMatched, sectionConfidence, meaningConfidence, intentConfidence, explanation, detectedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          monitorId,
          previous.id,
          snapshotId,
          change.category,
          change.oldValue,
          change.newValue,
          change.oldEvidence,
          change.newEvidence,
          match.section.heading,
          meaning.meaningful ? 1 : 0,
          qualifies ? 1 : 0,
          match.confidence,
          meaning.confidence,
          intentResult.confidence,
          explanation,
          now
        );
      const changeId = Number(result.lastInsertRowid);
      savedChanges.push(db.prepare('SELECT * FROM changes WHERE id = ?').get(changeId) as ChangeRow);

      if (qualifies) {
        const key = `${change.category}|${change.oldValue}|${change.newValue}`;
        if (!notified.has(key)) {
          notified.add(key);
          alertsCreated++;
          createNotification(
            monitorId,
            changeId,
            alertTitle(monitor.name, change.category, change.oldValue, change.newValue),
            `${meaning.explanation} ${intentResult.reason}`
          );
        }
      }
    }

    const meaningfulMatched = alertsCreated > 0;
    const quietReport = meaningfulMatched ? null : buildQuietReport(savedChanges);
    updateMonitor(monitorId, {
      status: wasPaused ? 'paused' : meaningfulMatched ? 'changed' : 'healthy',
      failureCount: 0,
      lastCheckedAt: now,
      nextCheckAt,
      lastError: null,
      // Track drift: the newly matched section becomes the reference.
      selectedSectionHeading: match.section.heading,
      selectedSectionText: sectionText,
      lastFetchDurationMs: durationMs,
      lastCheckSummary: meaningfulMatched ? 'alert' : detected.length > 0 ? 'irrelevant_change' : 'no_change'
    });

    return {
      status: meaningfulMatched ? 'changed' : 'healthy',
      snapshotId,
      changes: savedChanges,
      alertsCreated,
      quietReport,
      message: meaningfulMatched
        ? `${alertsCreated} meaningful change${alertsCreated === 1 ? '' : 's'} matched your instruction.`
        : quietReport
          ? quietReport.summary
          : 'No changes detected.'
    };
  } finally {
    runningMonitors.delete(monitorId);
  }
}

function safeParseFacts(json: string): Fact[] {
  try {
    return JSON.parse(json) as Fact[];
  } catch {
    return [];
  }
}

function alertTitle(monitorName: string, category: string, oldValue: string, newValue: string): string {
  const nice: Record<string, string> = {
    value_increase: 'increased',
    value_decrease: 'decreased',
    date_moved_earlier: 'moved earlier',
    date_moved_later: 'moved later',
    became_available: 'is now available',
    became_unavailable: 'is no longer available',
    requirement_tightened: 'became stricter',
    requirement_relaxed: 'was relaxed',
    schedule_changed: 'schedule changed',
    location_changed: 'location changed',
    contact_changed: 'contact info changed',
    addition: 'new information added',
    removal: 'information removed',
    text_change: 'content changed'
  };
  const verb = nice[category] ?? 'changed';
  if (oldValue && newValue) return `${monitorName}: ${verb} (${oldValue} → ${newValue})`;
  return `${monitorName}: ${verb}`;
}
