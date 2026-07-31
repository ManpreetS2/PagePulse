/**
 * Shared domain types for PagePulse.
 */

export type MonitorStatus =
  | 'healthy'
  | 'checking'
  | 'changed'
  | 'uncertain'
  | 'blocked'
  | 'failed'
  | 'paused';

export type CheckFrequency = '15min' | 'hourly' | '6hours' | 'daily' | 'manual';

export type TargetType =
  | 'deadline'
  | 'requirement'
  | 'price'
  | 'availability'
  | 'schedule'
  | 'location'
  | 'policy'
  | 'contact'
  | 'eligibility'
  | 'general';

export type FetchStatus = 'ok' | 'blocked' | 'timeout' | 'http_error' | 'unsupported' | 'network_error';

export type ChangeCategory =
  | 'addition'
  | 'removal'
  | 'value_increase'
  | 'value_decrease'
  | 'date_moved_earlier'
  | 'date_moved_later'
  | 'became_available'
  | 'became_unavailable'
  | 'requirement_tightened'
  | 'requirement_relaxed'
  | 'schedule_changed'
  | 'location_changed'
  | 'contact_changed'
  | 'text_change';

export type FactType =
  | 'date'
  | 'time'
  | 'price'
  | 'percentage'
  | 'gpa'
  | 'number'
  | 'availability'
  | 'email'
  | 'phone';

export interface Fact {
  type: FactType;
  /** Raw matched text, e.g. "September 30, 2026" or "$129.99". */
  raw: string;
  /** Normalized comparable value, e.g. "2026-09-30" or "129.99". */
  value: string;
  /** Numeric sort key when meaningful (timestamps, amounts). */
  sortKey: number | null;
  /** Nearby context, e.g. the variant a stock state applies to ("XL"). */
  context: string | null;
  /** The full sentence the fact appeared in. */
  sentence: string;
}

export interface Section {
  heading: string;
  /** Heading level 1-6, or 0 for content before the first heading. */
  level: number;
  /** Heading trail from ancestors, e.g. ["Admissions", "Transfer Students"]. */
  trail: string[];
  text: string;
  lines: string[];
}

export interface CleanedPage {
  title: string;
  finalUrl: string;
  sections: Section[];
  fullText: string;
}

export interface ParsedIntent {
  subject: string;
  field: TargetType;
  variant: string | null;
  trigger: 'any_change' | 'increase' | 'decrease' | 'becomes_available' | 'becomes_unavailable' | 'moves_earlier' | 'moves_later';
  keywords: string[];
  raw: string;
}

export interface SectionMatchResult {
  index: number;
  section: Section;
  confidence: number;
  reason: string;
  alternatives: Array<{ index: number; heading: string; confidence: number }>;
}

export interface DetectedChange {
  category: ChangeCategory;
  oldValue: string;
  newValue: string;
  /** Exact sentence/line from the old snapshot containing the change. */
  oldEvidence: string;
  /** Exact sentence/line from the new snapshot containing the change. */
  newEvidence: string;
  factType: FactType | null;
  context: string | null;
}

export interface MeaningResult {
  meaningful: boolean;
  confidence: number;
  reasonCodes: string[];
  explanation: string;
}

export interface IntentMatchResult {
  matched: boolean;
  confidence: number;
  reason: string;
}

export interface MonitorRow {
  id: number;
  name: string;
  url: string;
  userIntent: string;
  intentJson: string;
  selectedSectionHeading: string;
  selectedSectionText: string;
  extractedTargetType: TargetType;
  extractedTargetDescription: string;
  checkFrequency: CheckFrequency;
  relevanceThreshold: number;
  status: MonitorStatus;
  pausedBeforeFailure: string | null;
  failureCount: number;
  lastCheckedAt: string | null;
  nextCheckAt: string | null;
  lastError: string | null;
  lastFetchDurationMs: number | null;
  lastCheckSummary: string;
  createdAt: string;
  updatedAt: string;
}

export interface SnapshotRow {
  id: number;
  monitorId: number;
  retrievalTime: string;
  pageTitle: string;
  finalUrl: string;
  sectionHeading: string;
  cleanedSectionText: string;
  normalizedText: string;
  extractedFacts: string;
  contentHash: string;
  fetchStatus: FetchStatus;
  fetchDetails: string;
  sectionMatchConfidence: number;
}

export interface ChangeRow {
  id: number;
  monitorId: number;
  oldSnapshotId: number;
  newSnapshotId: number;
  category: ChangeCategory;
  oldValue: string;
  newValue: string;
  oldEvidence: string;
  newEvidence: string;
  sectionHeading: string;
  meaningful: number;
  intentMatched: number;
  sectionConfidence: number;
  meaningConfidence: number;
  intentConfidence: number;
  explanation: string;
  detectedAt: string;
  feedback: 'useful' | 'irrelevant' | null;
}

export interface NotificationRow {
  id: number;
  monitorId: number;
  changeId: number | null;
  title: string;
  message: string;
  read: number;
  createdAt: string;
}

export interface EvaluationRunRow {
  id: number;
  suiteId: string;
  scenarioId: string;
  scenarioName: string;
  expectedResult: string;
  actualResult: string;
  correct: number;
  sectionMatched: number;
  intentMatched: number;
  evidenceAccurate: number;
  details: string;
  createdAt: string;
}
