/**
 * Monitor creation and preview logic shared by the HTTP API and the
 * Evaluation Lab runner.
 */
import { getDb } from '../db.js';
import type { CheckFrequency, CleanedPage, MonitorRow, ParsedIntent, TargetType } from '../types.js';
import { fetchPage, type FetchResult } from './fetcher.js';
import { cleanPage } from './cleaner.js';
import { parseIntent } from './intent.js';
import { rankSectionsForIntent, type RankedSection } from './sectionMatch.js';
import { extractFacts, summarizeFacts } from './extract.js';
import { computeNextCheck } from './checkRunner.js';
import { sha256 } from './textUtils.js';

export class MonitorCreationError extends Error {
  constructor(message: string, public readonly fetchStatus: string) {
    super(message);
    this.name = 'MonitorCreationError';
  }
}

export interface PreviewResult {
  fetch: Pick<FetchResult, 'status' | 'httpStatus' | 'finalUrl' | 'details'>;
  retrievalTime: string;
  page: CleanedPage;
  intent: ParsedIntent;
  ranked: Array<Pick<RankedSection, 'index' | 'confidence' | 'reason'>>;
}

/** Step 2 + 3 of the wizard: fetch, clean, and rank sections for the intent. */
export async function previewUrl(url: string, userIntent: string): Promise<PreviewResult> {
  const fetchResult = await fetchPage(url);
  const retrievalTime = new Date().toISOString();
  if (fetchResult.status !== 'ok') {
    return {
      fetch: fetchResult,
      retrievalTime,
      page: { title: '', finalUrl: fetchResult.finalUrl, sections: [], fullText: '' },
      intent: parseIntent(userIntent),
      ranked: []
    };
  }
  const page = cleanPage(fetchResult.html, fetchResult.finalUrl);
  const intent = parseIntent(userIntent);
  const ranked = rankSectionsForIntent(page.sections, intent);
  return {
    fetch: { status: fetchResult.status, httpStatus: fetchResult.httpStatus, finalUrl: fetchResult.finalUrl, details: fetchResult.details },
    retrievalTime,
    page,
    intent,
    ranked: ranked.map(({ index, confidence, reason }) => ({ index, confidence, reason }))
  };
}

export interface CreateMonitorInput {
  name: string;
  url: string;
  userIntent: string;
  checkFrequency: CheckFrequency;
  /** Preferred section heading (from the preview step). */
  sectionHeading?: string;
  /** Fallback section index when headings are ambiguous. */
  sectionIndex?: number;
  relevanceThreshold?: number;
  /** User-reviewed structured interpretation overrides. */
  intentOverrides?: Partial<Pick<ParsedIntent, 'field' | 'variant' | 'trigger' | 'subject' | 'keywords'>>;
}

/**
 * Create a monitor: fetch the page fresh, select the section, save the
 * monitor plus its baseline snapshot. Throws MonitorCreationError when the
 * page cannot be monitored (with an honest reason).
 */
export async function createMonitor(input: CreateMonitorInput): Promise<MonitorRow> {
  const fetchResult = await fetchPage(input.url);
  if (fetchResult.status !== 'ok') {
    throw new MonitorCreationError(
      `This page cannot be monitored: ${fetchResult.details}`,
      fetchResult.status
    );
  }
  const page = cleanPage(fetchResult.html, fetchResult.finalUrl);
  if (page.sections.length === 0) {
    throw new MonitorCreationError(
      'This page cannot be monitored: no readable text sections were found. PagePulse supports server-rendered pages with readable text (not script-only apps or file downloads).',
      'unsupported'
    );
  }

  const intent = applyOverrides(parseIntent(input.userIntent), input.intentOverrides);

  // Section selection: explicit heading → explicit index → best-ranked.
  let sectionIdx = -1;
  if (input.sectionHeading) {
    sectionIdx = page.sections.findIndex((s) => s.heading === input.sectionHeading);
  }
  if (sectionIdx === -1 && typeof input.sectionIndex === 'number' && page.sections[input.sectionIndex]) {
    sectionIdx = input.sectionIndex;
  }
  if (sectionIdx === -1) {
    const ranked = rankSectionsForIntent(page.sections, intent);
    sectionIdx = ranked[0]?.index ?? 0;
  }
  const section = page.sections[sectionIdx]!;
  const facts = extractFacts(section.text);
  const targetType: TargetType = intent.field;

  const db = getDb();
  const nowIso = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO monitors (name, url, userIntent, intentJson, selectedSectionHeading, selectedSectionText,
        extractedTargetType, extractedTargetDescription, checkFrequency, relevanceThreshold, status, lastCheckedAt, nextCheckAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'healthy', ?, ?)`
    )
    .run(
      input.name,
      input.url,
      input.userIntent,
      JSON.stringify(intent),
      section.heading,
      section.text,
      targetType,
      summarizeFacts(facts) || intent.subject,
      input.checkFrequency,
      input.relevanceThreshold ?? 0.55,
      nowIso,
      computeNextCheck(input.checkFrequency)
    );
  const monitorId = Number(result.lastInsertRowid);

  db.prepare(
    `INSERT INTO snapshots (monitorId, retrievalTime, pageTitle, finalUrl, sectionHeading, cleanedSectionText,
      normalizedText, extractedFacts, contentHash, fetchStatus, fetchDetails, sectionMatchConfidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ok', ?, 1.0)`
  ).run(
    monitorId,
    nowIso,
    page.title,
    fetchResult.finalUrl,
    section.heading,
    section.text,
    section.text.toLowerCase(),
    JSON.stringify(facts),
    sha256(`${section.heading}\n${section.text}`),
    `Baseline saved. ${fetchResult.details}`
  );

  return db.prepare('SELECT * FROM monitors WHERE id = ?').get(monitorId) as MonitorRow;
}

export function applyOverrides(intent: ParsedIntent, overrides?: CreateMonitorInput['intentOverrides']): ParsedIntent {
  if (!overrides) return intent;
  return {
    ...intent,
    ...(overrides.field ? { field: overrides.field } : {}),
    ...(overrides.subject ? { subject: overrides.subject } : {}),
    ...(overrides.trigger ? { trigger: overrides.trigger } : {}),
    ...(overrides.keywords && overrides.keywords.length ? { keywords: overrides.keywords } : {}),
    variant: overrides.variant !== undefined ? overrides.variant : intent.variant
  };
}
