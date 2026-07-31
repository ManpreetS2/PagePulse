/**
 * Guided Demo — recruiter-friendly walkthrough that drives the real
 * monitoring pipeline against the transfer-gpa-workflow lab page.
 */
import { getDb, getSetting, setSetting } from '../db.js';
import { getSelfOrigin } from '../selfOrigin.js';
import { createMonitor } from './monitorService.js';
import { runCheck } from './checkRunner.js';
import { setActiveMutations } from '../lab/pages.js';
import type { ChangeRow, MonitorRow } from '../types.js';

export const DEMO_SETTING_KEY = 'guided_demo_state';
export const DEMO_MONITOR_NAME = 'Guided Demo — Transfer GPA';
export const DEMO_PAGE_SLUG = 'transfer-gpa-workflow';
export const DEMO_INTENT =
  'Alert me only if the minimum transferable GPA requirement changes. Ignore footer dates, formatting changes, rewording, and application deadlines.';

export type DemoStep = 'idle' | 'baseline' | 'reword' | 'unrelated' | 'meaningful' | 'complete';

export interface DemoState {
  step: DemoStep;
  monitorId: number | null;
  notificationId: number | null;
  alertChangeId: number | null;
  baselineSnapshotId: number | null;
  latestSnapshotId: number | null;
  message: string;
  updatedAt: string;
}

export interface DemoStepResult {
  state: DemoState;
  monitor: MonitorRow | null;
  outcome: {
    alertsCreated: number;
    status: string;
    message: string;
    changes: Array<{
      id: number;
      category: string;
      oldValue: string;
      newValue: string;
      oldEvidence: string;
      newEvidence: string;
      meaningful: number;
      intentMatched: number;
      explanation: string;
      meaningConfidence: number;
      intentConfidence: number;
      sectionConfidence: number;
    }>;
  } | null;
  extractedGpa: string | null;
  explanation: string;
}

const DEFAULT_STATE: DemoState = {
  step: 'idle',
  monitorId: null,
  notificationId: null,
  alertChangeId: null,
  baselineSnapshotId: null,
  latestSnapshotId: null,
  message: 'Start the guided demo to see PagePulse catch a real GPA change on a fictional admissions page.',
  updatedAt: new Date().toISOString()
};

function readState(): DemoState {
  try {
    const raw = getSetting(DEMO_SETTING_KEY, '');
    if (!raw) return { ...DEFAULT_STATE };
    const parsed = JSON.parse(raw) as DemoState;
    if (!parsed || typeof parsed.step !== 'string') return { ...DEFAULT_STATE };
    return { ...DEFAULT_STATE, ...parsed };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function writeState(state: DemoState): DemoState {
  const next = { ...state, updatedAt: new Date().toISOString() };
  setSetting(DEMO_SETTING_KEY, JSON.stringify(next));
  return next;
}

function demoUrl(): string {
  return `${getSelfOrigin()}/lab-pages/${DEMO_PAGE_SLUG}`;
}

function deleteDemoMonitors(): void {
  const db = getDb();
  const rows = db.prepare('SELECT id FROM monitors WHERE name = ?').all(DEMO_MONITOR_NAME) as Array<{ id: number }>;
  for (const row of rows) {
    db.prepare('DELETE FROM monitors WHERE id = ?').run(row.id);
  }
}

function getMonitor(id: number | null): MonitorRow | null {
  if (!id) return null;
  return (getDb().prepare('SELECT * FROM monitors WHERE id = ?').get(id) as MonitorRow | undefined) ?? null;
}

function latestGpa(monitorId: number): string | null {
  const snap = getDb()
    .prepare("SELECT extractedFacts FROM snapshots WHERE monitorId = ? AND fetchStatus = 'ok' ORDER BY id DESC LIMIT 1")
    .get(monitorId) as { extractedFacts: string } | undefined;
  if (!snap) return null;
  try {
    const facts = JSON.parse(snap.extractedFacts) as Array<{ type: string; value: string }>;
    const gpa = facts.find((f) => f.type === 'gpa');
    return gpa?.value ?? null;
  } catch {
    return null;
  }
}

function serializeChanges(changes: ChangeRow[]) {
  return changes.map((c) => ({
    id: c.id,
    category: c.category,
    oldValue: c.oldValue,
    newValue: c.newValue,
    oldEvidence: c.oldEvidence,
    newEvidence: c.newEvidence,
    meaningful: c.meaningful,
    intentMatched: c.intentMatched,
    explanation: c.explanation,
    meaningConfidence: c.meaningConfidence,
    intentConfidence: c.intentConfidence,
    sectionConfidence: c.sectionConfidence
  }));
}

export function getDemoStatus(): DemoStepResult {
  const state = readState();
  const monitor = getMonitor(state.monitorId);
  return {
    state: monitor ? state : writeState({ ...DEFAULT_STATE }),
    monitor,
    outcome: null,
    extractedGpa: monitor ? latestGpa(monitor.id) : null,
    explanation: state.message
  };
}

export async function startGuidedDemo(): Promise<DemoStepResult> {
  deleteDemoMonitors();
  setActiveMutations(DEMO_PAGE_SLUG, []);

  const monitor = await createMonitor({
    name: DEMO_MONITOR_NAME,
    url: demoUrl(),
    userIntent: DEMO_INTENT,
    checkFrequency: 'manual',
    sectionHeading: 'Minimum GPA',
    relevanceThreshold: 0.55
  });

  const baseline = getDb()
    .prepare('SELECT id FROM snapshots WHERE monitorId = ? ORDER BY id ASC LIMIT 1')
    .get(monitor.id) as { id: number } | undefined;

  const gpa = latestGpa(monitor.id);
  const state = writeState({
    step: 'baseline',
    monitorId: monitor.id,
    notificationId: null,
    alertChangeId: null,
    baselineSnapshotId: baseline?.id ?? null,
    latestSnapshotId: baseline?.id ?? null,
    message: `Baseline saved. PagePulse is watching the Minimum GPA section with extracted value ${gpa ?? '3.20'}.`,
    updatedAt: new Date().toISOString()
  });

  return {
    state,
    monitor,
    outcome: {
      alertsCreated: 0,
      status: 'healthy',
      message: 'Baseline saved.',
      changes: []
    },
    extractedGpa: gpa,
    explanation:
      'A clean baseline of the Minimum GPA section was saved. The extracted GPA is 3.20. Next, PagePulse will see an equivalent rewording that must not alert.'
  };
}

export async function continueGuidedDemo(): Promise<DemoStepResult> {
  const state = readState();
  const monitor = getMonitor(state.monitorId);
  if (!monitor || state.step === 'idle') {
    return startGuidedDemo();
  }
  if (state.step === 'complete') {
    return {
      state,
      monitor,
      outcome: null,
      extractedGpa: latestGpa(monitor.id),
      explanation: state.message
    };
  }

  if (state.step === 'baseline') {
    setActiveMutations(DEMO_PAGE_SLUG, ['reword-gpa']);
    const outcome = await runCheck(monitor.id);
    const next = writeState({
      ...state,
      step: 'reword',
      latestSnapshotId: outcome.snapshotId,
      message: outcome.message,
      updatedAt: new Date().toISOString()
    });
    return {
      state: next,
      monitor: getMonitor(monitor.id),
      outcome: {
        alertsCreated: outcome.alertsCreated,
        status: outcome.status,
        message: outcome.message,
        changes: serializeChanges(outcome.changes)
      },
      extractedGpa: latestGpa(monitor.id),
      explanation:
        outcome.alertsCreated === 0
          ? 'Equivalent rewording applied. The GPA is still 3.20, so PagePulse recorded the text shift but created no meaningful alert.'
          : 'Unexpected alert during rewording step — review the change details below.'
    };
  }

  if (state.step === 'reword') {
    setActiveMutations(DEMO_PAGE_SLUG, ['reword-gpa', 'deadline-change', 'footer-year']);
    const outcome = await runCheck(monitor.id);
    const next = writeState({
      ...state,
      step: 'unrelated',
      latestSnapshotId: outcome.snapshotId,
      message: outcome.message,
      updatedAt: new Date().toISOString()
    });
    return {
      state: next,
      monitor: getMonitor(monitor.id),
      outcome: {
        alertsCreated: outcome.alertsCreated,
        status: outcome.status,
        message: outcome.message,
        changes: serializeChanges(outcome.changes)
      },
      extractedGpa: latestGpa(monitor.id),
      explanation:
        outcome.alertsCreated === 0
          ? 'An unrelated application deadline and footer year changed. The GPA monitor ignored them because they are outside the monitored section and intent.'
          : 'Unexpected alert during the unrelated-change step.'
    };
  }

  // meaningful step
  setActiveMutations(DEMO_PAGE_SLUG, ['gpa-increase']);
  const outcome = await runCheck(monitor.id);
  const alertChange = outcome.changes.find((c) => c.intentMatched === 1) ?? null;
  const notif = alertChange
    ? (getDb()
        .prepare('SELECT id FROM notifications WHERE monitorId = ? AND changeId = ? ORDER BY id DESC LIMIT 1')
        .get(monitor.id, alertChange.id) as { id: number } | undefined)
    : undefined;

  const next = writeState({
    ...state,
    step: 'complete',
    latestSnapshotId: outcome.snapshotId,
    alertChangeId: alertChange?.id ?? null,
    notificationId: notif?.id ?? null,
    message: outcome.message,
    updatedAt: new Date().toISOString()
  });

  return {
    state: next,
    monitor: getMonitor(monitor.id),
    outcome: {
      alertsCreated: outcome.alertsCreated,
      status: outcome.status,
      message: outcome.message,
      changes: serializeChanges(outcome.changes)
    },
    extractedGpa: latestGpa(monitor.id),
    explanation:
      alertChange
        ? `Meaningful change detected: GPA moved from ${alertChange.oldValue} to ${alertChange.newValue}. PagePulse created an evidence-backed alert because the underlying requirement tightened and matched your instruction.`
        : 'Expected a GPA alert, but none was created. Check the Evaluation Lab and logs.'
  };
}

export function resetGuidedDemo(): DemoStepResult {
  deleteDemoMonitors();
  setActiveMutations(DEMO_PAGE_SLUG, []);
  const state = writeState({ ...DEFAULT_STATE });
  return {
    state,
    monitor: null,
    outcome: null,
    extractedGpa: null,
    explanation: 'Demo reset. Lab page restored to baseline and the demo monitor was removed.'
  };
}
