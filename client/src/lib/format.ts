import type { CheckFrequency, MonitorStatus } from './types';

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return iso;
  const diffMs = d.getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const units: Array<[number, string]> = [
    [60_000, 'minute'],
    [3_600_000, 'hour'],
    [86_400_000, 'day']
  ];
  if (abs < 45_000) return diffMs <= 0 ? 'just now' : 'in under a minute';
  let value = Math.round(abs / 60_000);
  let unit = 'minute';
  for (const [ms, name] of units) {
    if (abs >= ms) {
      value = Math.round(abs / ms);
      unit = name;
    }
  }
  const plural = value === 1 ? unit : `${unit}s`;
  return diffMs <= 0 ? `${value} ${plural} ago` : `in ${value} ${plural}`;
}

export function percent(x: number | null | undefined): string {
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  return `${Math.round(x * 100)}%`;
}

export function hostname(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export const FREQUENCY_LABELS: Record<CheckFrequency, string> = {
  '15min': 'Every 15 minutes',
  hourly: 'Hourly',
  '6hours': 'Every 6 hours',
  daily: 'Daily',
  manual: 'Manual only'
};

export const STATUS_LABELS: Record<MonitorStatus, string> = {
  healthy: 'Healthy',
  checking: 'Checking',
  changed: 'Changed',
  uncertain: 'Uncertain',
  blocked: 'Blocked',
  failed: 'Failed',
  paused: 'Paused'
};

export const CATEGORY_LABELS: Record<string, string> = {
  addition: 'Added',
  removal: 'Removed',
  value_increase: 'Value increased',
  value_decrease: 'Value decreased',
  date_moved_earlier: 'Date moved earlier',
  date_moved_later: 'Date moved later',
  became_available: 'Became available',
  became_unavailable: 'Became unavailable',
  requirement_tightened: 'Requirement tightened',
  requirement_relaxed: 'Requirement relaxed',
  schedule_changed: 'Schedule changed',
  location_changed: 'Location changed',
  contact_changed: 'Contact changed',
  text_change: 'Text changed'
};

export const TRIGGER_LABELS: Record<string, string> = {
  any_change: 'Any change',
  increase: 'Increases',
  decrease: 'Decreases',
  becomes_available: 'Becomes available',
  becomes_unavailable: 'Becomes unavailable',
  moves_earlier: 'Moves earlier',
  moves_later: 'Moves later'
};

export const FIELD_LABELS: Record<string, string> = {
  deadline: 'Deadline',
  requirement: 'Requirement',
  price: 'Price',
  availability: 'Availability',
  schedule: 'Schedule',
  location: 'Location',
  policy: 'Policy',
  contact: 'Contact info',
  eligibility: 'Eligibility',
  general: 'General text'
};
