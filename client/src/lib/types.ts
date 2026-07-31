/** Client-side mirrors of the server API types. */

export type MonitorStatus = 'healthy' | 'checking' | 'changed' | 'uncertain' | 'blocked' | 'failed' | 'paused';
export type CheckFrequency = '15min' | 'hourly' | '6hours' | 'daily' | 'manual';
export type TargetType =
  | 'deadline' | 'requirement' | 'price' | 'availability' | 'schedule'
  | 'location' | 'policy' | 'contact' | 'eligibility' | 'general';
export type IntentTrigger =
  | 'any_change' | 'increase' | 'decrease' | 'becomes_available'
  | 'becomes_unavailable' | 'moves_earlier' | 'moves_later';

export interface ParsedIntent {
  subject: string;
  field: TargetType;
  variant: string | null;
  trigger: IntentTrigger;
  keywords: string[];
  raw: string;
}

export interface Fact {
  type: string;
  raw: string;
  value: string;
  sortKey: number | null;
  context: string | null;
  sentence: string;
}

export interface Section {
  heading: string;
  level: number;
  trail: string[];
  text: string;
  lines: string[];
}

export interface Monitor {
  id: number;
  name: string;
  url: string;
  userIntent: string;
  intent: ParsedIntent;
  selectedSectionHeading: string;
  selectedSectionText: string;
  extractedTargetType: TargetType;
  extractedTargetDescription: string;
  checkFrequency: CheckFrequency;
  relevanceThreshold: number;
  status: MonitorStatus;
  failureCount: number;
  lastCheckedAt: string | null;
  nextCheckAt: string | null;
  lastError: string | null;
  lastFetchDurationMs?: number | null;
  lastCheckSummary?: string;
  createdAt: string;
  updatedAt: string;
  versionCount: number;
  meaningfulChangeCount: number;
  unreadCount: number;
  confidence: number;
  currentSummary: string;
  health?: {
    displayStatus: string;
    label: string;
    description: string;
    dueSoon: boolean;
    lastCheckSummary: string;
  };
  monitoredSection?: string;
  latestExtractedValue?: string | null;
  lastSuccessfulCheckAt?: string | null;
}

export interface Snapshot {
  id: number;
  monitorId: number;
  retrievalTime: string;
  pageTitle: string;
  finalUrl: string;
  sectionHeading: string;
  cleanedSectionText: string;
  extractedFacts: Fact[];
  contentHash: string;
  fetchStatus: string;
  fetchDetails: string;
  sectionMatchConfidence: number;
  changeSummary?: { total: number; meaningful: number; alerts: number };
}

export interface Change {
  id: number;
  monitorId: number;
  oldSnapshotId: number;
  newSnapshotId: number;
  category: string;
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

export interface Notification {
  id: number;
  monitorId: number;
  changeId: number | null;
  title: string;
  message: string;
  read: number;
  createdAt: string;
  monitorName: string;
  monitorUrl: string;
  monitorIntent: string;
  change: Change | null;
}

export interface PreviewResult {
  fetch: { status: string; httpStatus: number | null; finalUrl: string; details: string };
  retrievalTime: string;
  page: { title: string; finalUrl: string; sections: Section[]; fullText: string };
  intent: ParsedIntent;
  ranked: Array<{ index: number; confidence: number; reason: string }>;
}

export interface CheckOutcome {
  status: MonitorStatus;
  snapshotId: number | null;
  changes: Change[];
  alertsCreated: number;
  message: string;
  monitor: Monitor;
}

export interface Stats {
  activeMonitors: number;
  totalMonitors: number;
  meaningfulChanges: number;
  unreadAlerts: number;
  checksCompleted: number;
  attentionMonitors: number;
  falseAlertFeedback: number;
}

export interface LabMutation {
  id: string;
  label: string;
  kind: 'meaningful' | 'harmless';
  description: string;
}

export interface LabPage {
  slug: string;
  name: string;
  description: string;
  suggestedIntent: string;
  url: string;
  mutations: LabMutation[];
  activeMutations: string[];
}

export interface EvalScenario {
  id: string;
  name: string;
  description: string;
  pageSlug: string;
  intent: string;
  mutations: string[];
  kind: 'meaningful' | 'harmless' | 'irrelevant';
  expected: 'alert' | 'no_alert';
}

export interface ScenarioResult {
  scenarioId: string;
  scenarioName: string;
  kind: 'meaningful' | 'harmless' | 'irrelevant';
  expected: string;
  actual: string;
  correct: boolean;
  sectionMatched: boolean;
  intentMatched: boolean;
  evidenceAccurate: boolean;
  details: {
    checkMessage: string;
    trackedSection: string;
    alertingChanges: Array<Pick<Change, 'category' | 'oldValue' | 'newValue' | 'oldEvidence' | 'newEvidence' | 'explanation'>>;
    error?: string;
  };
}

export interface SuiteMetrics {
  totalScenarios: number;
  passed: number;
  failed: number;
  meaningfulTotal: number;
  meaningfulCaught: number;
  recall: number | null;
  quietTotal: number;
  falseAlerts: number;
  falseAlertRate: number | null;
  sectionTrackingAccuracy: number | null;
  intentMatchAccuracy: number | null;
  evidenceAccuracy: number | null;
  faithfulness: number | null;
  confusion: { truePositives: number; falseNegatives: number; falsePositives: number; trueNegatives: number };
}

export interface SuiteReport {
  suiteId: string;
  startedAt: string;
  finishedAt: string;
  results: ScenarioResult[];
  metrics: SuiteMetrics;
}

export interface Settings {
  defaultFrequency: CheckFrequency;
  defaultRelevanceThreshold: number;
  notificationsEnabled: boolean;
  theme: string;
  email: { configured: boolean; note: string };
  comparisonEngine: { name: string; description: string };
}

export interface CompareResult {
  monitor: { id: number; name: string; userIntent: string };
  oldSnapshot: Snapshot;
  newSnapshot: Snapshot;
  changes: Array<{
    category: string;
    oldValue: string;
    newValue: string;
    oldEvidence: string;
    newEvidence: string;
    factType: string | null;
    context: string | null;
    meaning: { meaningful: boolean; confidence: number; reasonCodes: string[]; explanation: string };
    intentResult: { matched: boolean; confidence: number; reason: string };
  }>;
  factSummary?: {
    confirmedChanged: Array<{ type: string; oldValue: string; newValue: string; context: string | null }>;
    unchanged: Array<{ type: string; value: string; context: string | null }>;
    ignoredUnrelated: Array<{ category: string; summary: string; reason: string }>;
  };
}

export interface GuidedDemoResult {
  state: {
    step: 'idle' | 'baseline' | 'reword' | 'unrelated' | 'meaningful' | 'complete';
    monitorId: number | null;
    notificationId: number | null;
    alertChangeId: number | null;
    baselineSnapshotId: number | null;
    latestSnapshotId: number | null;
    message: string;
    updatedAt: string;
  };
  monitor: Monitor | null;
  outcome: {
    alertsCreated: number;
    status: string;
    message: string;
    changes: Change[];
  } | null;
  extractedGpa: string | null;
  explanation: string;
}
