/**
 * Monitor health presentation — maps raw monitor rows to recruiter-friendly
 * display statuses with icons/text (not color alone).
 */
import type { CheckFrequency, MonitorStatus } from '../types.js';

export type DisplayHealth =
  | 'healthy'
  | 'due_soon'
  | 'checking'
  | 'meaningful_change'
  | 'no_relevant_change'
  | 'blocked'
  | 'failed'
  | 'uncertain'
  | 'manual_only'
  | 'paused';

export type LastCheckSummary =
  | 'baseline'
  | 'no_change'
  | 'irrelevant_change'
  | 'alert'
  | 'failed'
  | 'blocked'
  | 'uncertain'
  | 'never';

export interface MonitorHealthView {
  displayStatus: DisplayHealth;
  label: string;
  description: string;
  dueSoon: boolean;
  lastCheckSummary: LastCheckSummary;
}

const DUE_SOON_MS = 15 * 60_000;

export function deriveMonitorHealth(input: {
  status: MonitorStatus;
  checkFrequency: CheckFrequency;
  nextCheckAt: string | null;
  lastCheckSummary: string | null;
  failureCount: number;
  lastError: string | null;
}): MonitorHealthView {
  const summary = (input.lastCheckSummary as LastCheckSummary) || 'never';
  const dueSoon =
    Boolean(input.nextCheckAt) &&
    !Number.isNaN(Date.parse(input.nextCheckAt!)) &&
    Date.parse(input.nextCheckAt!) - Date.now() <= DUE_SOON_MS &&
    Date.parse(input.nextCheckAt!) - Date.now() >= 0;

  if (input.status === 'checking') {
    return {
      displayStatus: 'checking',
      label: 'Checking',
      description: 'PagePulse is fetching and analyzing the page right now.',
      dueSoon: false,
      lastCheckSummary: summary
    };
  }
  if (input.status === 'blocked') {
    return {
      displayStatus: 'blocked',
      label: 'Blocked',
      description: input.lastError || 'This page cannot be monitored (private network, unsupported type, or blocked destination).',
      dueSoon: false,
      lastCheckSummary: summary
    };
  }
  if (input.status === 'failed') {
    return {
      displayStatus: 'failed',
      label: 'Failed',
      description:
        input.lastError ||
        `The last check failed${input.failureCount > 0 ? ` (${input.failureCount} consecutive failure${input.failureCount === 1 ? '' : 's'})` : ''}.`,
      dueSoon: false,
      lastCheckSummary: summary
    };
  }
  if (input.status === 'uncertain') {
    return {
      displayStatus: 'uncertain',
      label: 'Uncertain',
      description: input.lastError || 'PagePulse could not confidently locate the monitored section. Review and re-select if needed.',
      dueSoon: false,
      lastCheckSummary: summary
    };
  }
  if (input.status === 'paused') {
    return {
      displayStatus: 'paused',
      label: 'Paused',
      description: 'Scheduled checks are paused. Resume when you want monitoring to continue.',
      dueSoon: false,
      lastCheckSummary: summary
    };
  }
  if (input.status === 'changed') {
    return {
      displayStatus: 'meaningful_change',
      label: 'Meaningful change detected',
      description: 'A meaningful change matched your monitoring instruction. Review the alert for evidence.',
      dueSoon,
      lastCheckSummary: summary
    };
  }
  if (summary === 'irrelevant_change') {
    return {
      displayStatus: 'no_relevant_change',
      label: 'No relevant change',
      description: 'Page content shifted, but nothing meaningful matched your instruction.',
      dueSoon,
      lastCheckSummary: summary
    };
  }
  if (input.checkFrequency === 'manual') {
    return {
      displayStatus: 'manual_only',
      label: 'Manual only',
      description: 'This monitor only runs when you click Check now.',
      dueSoon: false,
      lastCheckSummary: summary
    };
  }
  if (dueSoon) {
    return {
      displayStatus: 'due_soon',
      label: 'Due soon',
      description: 'The next scheduled check is coming up within 15 minutes.',
      dueSoon: true,
      lastCheckSummary: summary
    };
  }
  return {
    displayStatus: 'healthy',
    label: 'Healthy',
    description: 'Last check succeeded. No meaningful, intent-matched change is pending review.',
    dueSoon: false,
    lastCheckSummary: summary
  };
}
