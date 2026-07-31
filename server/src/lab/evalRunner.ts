/**
 * Evaluation suite runner.
 *
 * Executes deterministic scenarios end-to-end through the REAL pipeline:
 * lab page reset → monitor creation (fetch/clean/rank) → mutation →
 * check (fetch/match/diff/meaning/intent/alert) → grading. Results are
 * persisted so metrics are repeatable and auditable.
 */
import { randomUUID } from 'node:crypto';
import { getDb } from '../db.js';
import type { ChangeRow, EvaluationRunRow, MonitorRow, SnapshotRow } from '../types.js';
import { createMonitor } from '../lib/monitorService.js';
import { runCheck } from '../lib/checkRunner.js';
import { labPageUrl } from '../selfOrigin.js';
import { setActiveMutations } from './pages.js';
import { EVAL_SCENARIOS, type EvalScenario } from './scenarios.js';

export interface ScenarioResult {
  scenarioId: string;
  scenarioName: string;
  kind: EvalScenario['kind'];
  expected: string;
  actual: string;
  correct: boolean;
  sectionMatched: boolean;
  intentMatched: boolean;
  evidenceAccurate: boolean;
  details: {
    checkMessage: string;
    trackedSection: string;
    alertingChanges: Array<Pick<ChangeRow, 'category' | 'oldValue' | 'newValue' | 'oldEvidence' | 'newEvidence' | 'explanation'>>;
    error?: string;
  };
}

export interface SuiteReport {
  suiteId: string;
  startedAt: string;
  finishedAt: string;
  results: ScenarioResult[];
  metrics: SuiteMetrics;
}

export interface SuiteMetrics {
  totalScenarios: number;
  passed: number;
  failed: number;
  meaningfulTotal: number;
  meaningfulCaught: number;
  /** Recall over meaningful scenarios (null when no data). */
  recall: number | null;
  quietTotal: number;
  falseAlerts: number;
  falseAlertRate: number | null;
  sectionTrackingAccuracy: number | null;
  intentMatchAccuracy: number | null;
  /** Over alert-producing scenarios: values match the expected old/new. */
  evidenceAccuracy: number | null;
  /** Over produced alerts: quoted values literally appear in the evidence. */
  faithfulness: number | null;
  confusion: { truePositives: number; falseNegatives: number; falsePositives: number; trueNegatives: number };
}

async function runScenario(scenario: EvalScenario, suiteId: string): Promise<ScenarioResult> {
  const db = getDb();
  let monitor: MonitorRow | null = null;
  const result: ScenarioResult = {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    kind: scenario.kind,
    expected: scenario.expected,
    actual: 'error',
    correct: false,
    sectionMatched: false,
    intentMatched: false,
    evidenceAccurate: false,
    details: { checkMessage: '', trackedSection: '', alertingChanges: [] }
  };

  try {
    // 1. Baseline.
    setActiveMutations(scenario.pageSlug, []);
    // 2. Create the monitor exactly the way the app does.
    monitor = await createMonitor({
      name: `[eval] ${scenario.name}`,
      url: labPageUrl(scenario.pageSlug),
      userIntent: scenario.intent,
      checkFrequency: 'manual'
    });
    // 3. Apply the controlled mutations.
    setActiveMutations(scenario.pageSlug, scenario.mutations);
    // 4. Run the real check pipeline.
    const outcome = await runCheck(monitor.id);
    result.details.checkMessage = outcome.message;

    const latest = db
      .prepare('SELECT * FROM snapshots WHERE monitorId = ? ORDER BY id DESC LIMIT 1')
      .get(monitor.id) as SnapshotRow | undefined;
    result.details.trackedSection = latest?.sectionHeading ?? '';

    const alerting = outcome.changes.filter((c) => c.intentMatched === 1);
    result.details.alertingChanges = alerting.map((c) => ({
      category: c.category,
      oldValue: c.oldValue,
      newValue: c.newValue,
      oldEvidence: c.oldEvidence,
      newEvidence: c.newEvidence,
      explanation: c.explanation
    }));

    // 5. Grade.
    result.actual = outcome.alertsCreated > 0 ? 'alert' : 'no_alert';
    result.correct = result.actual === scenario.expected;
    result.sectionMatched = (latest?.sectionHeading ?? '')
      .toLowerCase()
      .includes(scenario.expectedSectionContains.toLowerCase());

    if (scenario.expected === 'alert') {
      const good = alerting.find((c) => {
        const categoryOk = !scenario.expectedCategories || scenario.expectedCategories.includes(c.category);
        const oldOk = !scenario.expectedOldValue || c.oldValue.includes(scenario.expectedOldValue) || c.oldEvidence.includes(scenario.expectedOldValue);
        const newOk = !scenario.expectedNewValue || c.newValue.includes(scenario.expectedNewValue) || c.newEvidence.includes(scenario.expectedNewValue);
        return categoryOk && oldOk && newOk;
      });
      result.intentMatched = Boolean(good);
      // Evidence accuracy: the values the alert quotes literally appear in
      // the evidence sentences (nothing was invented). Composite values like
      // "XL: Sold out" are checked part by part against "XL | Sold out".
      const grounded = (value: string, evidence: string): boolean => {
        if (!value || evidence.length === 0) return true;
        return value.split(/:\s*/).every((part) => evidence.includes(part.replace(/…$/, '')));
      };
      result.evidenceAccurate =
        alerting.length > 0 &&
        alerting.every((c) => grounded(c.oldValue, c.oldEvidence) && grounded(c.newValue, c.newEvidence)) &&
        Boolean(good);
    } else {
      // For quiet scenarios: intent filtering succeeded iff nothing alerted,
      // and no evidence can be fabricated when no alert exists.
      result.intentMatched = result.correct;
      result.evidenceAccurate = result.correct;
    }
  } catch (err) {
    result.details.error = err instanceof Error ? err.message : String(err);
    result.actual = 'error';
  } finally {
    // Cleanup: remove the temporary monitor and restore the baseline.
    if (monitor) db.prepare('DELETE FROM monitors WHERE id = ?').run(monitor.id);
    setActiveMutations(scenario.pageSlug, []);
  }

  db.prepare(
    `INSERT INTO evaluation_runs (suiteId, scenarioId, scenarioName, expectedResult, actualResult, correct, sectionMatched, intentMatched, evidenceAccurate, details)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    suiteId,
    scenario.id,
    scenario.name,
    scenario.expected,
    result.actual,
    result.correct ? 1 : 0,
    result.sectionMatched ? 1 : 0,
    result.intentMatched ? 1 : 0,
    result.evidenceAccurate ? 1 : 0,
    JSON.stringify({ kind: scenario.kind, ...result.details })
  );
  return result;
}

export function computeMetrics(results: ScenarioResult[]): SuiteMetrics {
  const meaningful = results.filter((r) => r.kind === 'meaningful');
  const quiet = results.filter((r) => r.kind !== 'meaningful');
  const caught = meaningful.filter((r) => r.actual === 'alert').length;
  const falseAlerts = quiet.filter((r) => r.actual === 'alert').length;
  const alertProduced = results.filter((r) => r.actual === 'alert');
  const expectedAlerts = results.filter((r) => r.expected === 'alert');

  const ratio = (num: number, den: number): number | null => (den === 0 ? null : num / den);

  return {
    totalScenarios: results.length,
    passed: results.filter((r) => r.correct).length,
    failed: results.filter((r) => !r.correct).length,
    meaningfulTotal: meaningful.length,
    meaningfulCaught: caught,
    recall: ratio(caught, meaningful.length),
    quietTotal: quiet.length,
    falseAlerts,
    falseAlertRate: ratio(falseAlerts, quiet.length),
    sectionTrackingAccuracy: ratio(results.filter((r) => r.sectionMatched).length, results.length),
    intentMatchAccuracy: ratio(results.filter((r) => r.intentMatched).length, results.length),
    evidenceAccuracy: ratio(expectedAlerts.filter((r) => r.evidenceAccurate).length, expectedAlerts.length),
    faithfulness: ratio(alertProduced.filter((r) => r.evidenceAccurate).length, alertProduced.length),
    confusion: {
      truePositives: caught,
      falseNegatives: meaningful.length - caught,
      falsePositives: falseAlerts,
      trueNegatives: quiet.length - falseAlerts
    }
  };
}

let suiteRunning = false;

export function isSuiteRunning(): boolean {
  return suiteRunning;
}

export async function runSuite(scenarioIds?: string[]): Promise<SuiteReport> {
  if (suiteRunning) throw new Error('An evaluation suite is already running.');
  suiteRunning = true;
  const startedAt = new Date().toISOString();
  const suiteId = randomUUID();
  try {
    const scenarios = scenarioIds?.length
      ? EVAL_SCENARIOS.filter((s) => scenarioIds.includes(s.id))
      : EVAL_SCENARIOS;
    const results: ScenarioResult[] = [];
    for (const scenario of scenarios) {
      results.push(await runScenario(scenario, suiteId));
    }
    return { suiteId, startedAt, finishedAt: new Date().toISOString(), results, metrics: computeMetrics(results) };
  } finally {
    suiteRunning = false;
  }
}

/** Rebuild the latest suite's report from persisted rows. */
export function latestSuiteReport(): SuiteReport | null {
  const db = getDb();
  const latest = db
    .prepare("SELECT suiteId, MIN(createdAt) as startedAt, MAX(createdAt) as finishedAt FROM evaluation_runs WHERE suiteId != '' GROUP BY suiteId ORDER BY MAX(createdAt) DESC LIMIT 1")
    .get() as { suiteId: string; startedAt: string; finishedAt: string } | undefined;
  if (!latest) return null;
  const rows = db
    .prepare('SELECT * FROM evaluation_runs WHERE suiteId = ? ORDER BY id ASC')
    .all(latest.suiteId) as EvaluationRunRow[];
  const results: ScenarioResult[] = rows.map((row) => {
    let details: ScenarioResult['details'] & { kind?: EvalScenario['kind'] } = {
      checkMessage: '',
      trackedSection: '',
      alertingChanges: []
    };
    try {
      details = { ...details, ...(JSON.parse(row.details) as typeof details) };
    } catch {
      /* keep defaults */
    }
    return {
      scenarioId: row.scenarioId,
      scenarioName: row.scenarioName,
      kind: details.kind ?? 'meaningful',
      expected: row.expectedResult,
      actual: row.actualResult,
      correct: row.correct === 1,
      sectionMatched: row.sectionMatched === 1,
      intentMatched: row.intentMatched === 1,
      evidenceAccurate: row.evidenceAccurate === 1,
      details
    };
  });
  return {
    suiteId: latest.suiteId,
    startedAt: latest.startedAt,
    finishedAt: latest.finishedAt,
    results,
    metrics: computeMetrics(results)
  };
}
