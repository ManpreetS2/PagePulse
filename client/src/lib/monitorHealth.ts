/** Shared monitor health labels used by dashboard and detail pages. */

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

export interface MonitorHealth {
  displayStatus: DisplayHealth;
  label: string;
  description: string;
  dueSoon: boolean;
  lastCheckSummary: string;
}

export const DISPLAY_HEALTH_LABELS: Record<DisplayHealth, string> = {
  healthy: 'Healthy',
  due_soon: 'Due soon',
  checking: 'Checking',
  meaningful_change: 'Meaningful change detected',
  no_relevant_change: 'No relevant change',
  blocked: 'Blocked',
  failed: 'Failed',
  uncertain: 'Uncertain',
  manual_only: 'Manual only',
  paused: 'Paused'
};

export function formatDurationMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}
