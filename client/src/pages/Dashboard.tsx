import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Activity, Bell, CheckSquare, Eye, FlaskConical, MonitorX, Pause, Play, Plus,
  RefreshCw, Sparkles, ThumbsDown, Trash2, Zap
} from 'lucide-react';
import { ApiError, del, formatApiError, get, post } from '../lib/api';
import type { CheckOutcome, Monitor, Stats } from '../lib/types';
import { FREQUENCY_LABELS, formatRelative, hostname } from '../lib/format';
import { formatDurationMs } from '../lib/monitorHealth';
import { Button, Card, ConfidenceMeter, ConfirmDialog, EmptyState, ErrorBanner, HealthBadge, PageSpinner, StatusBadge } from '../components/ui';

function StatCard({ icon, label, value, tone = '' }: { icon: React.ReactNode; label: string; value: number; tone?: string }) {
  return (
    <Card className="flex items-center gap-3 p-4">
      <div className={`rounded-lg bg-zinc-100 p-2 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 ${tone}`}>{icon}</div>
      <div>
        <div className="text-xl font-semibold tabular-nums">{value}</div>
        <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
      </div>
    </Card>
  );
}

export default function Dashboard() {
  const [monitors, setMonitors] = useState<Monitor[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [busyAction, setBusyAction] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Monitor | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      const [m, s] = await Promise.all([get<Monitor[]>('/api/monitors'), get<Stats>('/api/stats')]);
      setMonitors(m);
      setStats(s);
    } catch (err) {
      setError(formatApiError(err, 'Failed to load.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = async (monitor: Monitor, action: 'check' | 'pause' | 'resume' | 'delete') => {
    // Ignore double-clicks while this (or another) monitor action is in flight.
    if (busyId !== null) return;
    setBusyId(monitor.id);
    setBusyAction(action);
    setError('');
    try {
      if (action === 'check') {
        setStatusMessage(`Checking “${monitor.name}”…`);
        const outcome = await post<CheckOutcome>(`/api/monitors/${monitor.id}/check`);
        setStatusMessage(`“${monitor.name}”: ${outcome.quietReport?.summary || outcome.message}`);
      } else if (action === 'delete') {
        await del(`/api/monitors/${monitor.id}`);
        setDeleteTarget(null);
        setStatusMessage(`Deleted “${monitor.name}”.`);
      } else {
        await post(`/api/monitors/${monitor.id}/${action}`);
        setStatusMessage(action === 'pause' ? `Paused “${monitor.name}”.` : `Resumed “${monitor.name}”.`);
      }
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && action === 'check') {
        setStatusMessage(formatApiError(err));
        setError('');
      } else {
        setError(formatApiError(err, 'Action failed.'));
        if (action === 'check') setStatusMessage('');
      }
    } finally {
      setBusyId(null);
      setBusyAction('');
    }
  };

  const loadSamples = async () => {
    setBusyId(-1);
    setBusyAction('samples');
    setError('');
    try {
      await post('/api/samples/load');
      setStatusMessage('Sample monitors loaded. They point at the local Evaluation Lab pages.');
      await load();
    } catch (err) {
      setError(formatApiError(err, 'Could not load samples.'));
    } finally {
      setBusyId(null);
      setBusyAction('');
    }
  };

  if (!monitors || !stats) return error ? <ErrorBanner message={error} /> : <PageSpinner label="Loading dashboard…" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Your monitors at a glance.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/demo"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-medium text-sky-800 hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200 dark:hover:bg-sky-900"
          >
            <Sparkles className="h-4 w-4" aria-hidden />
            Guided Demo
          </Link>
          <Link
            to="/monitors/new"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 dark:bg-sky-500 dark:text-zinc-950 dark:hover:bg-sky-400"
          >
            <Plus className="h-4 w-4" aria-hidden />
            New monitor
          </Link>
        </div>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}
      <p aria-live="polite" className="sr-only">
        {statusMessage}
      </p>
      {statusMessage && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm text-sky-800 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200">
          {statusMessage}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard icon={<Activity className="h-4 w-4" aria-hidden />} label="Active monitors" value={stats.activeMonitors} />
        <StatCard icon={<Zap className="h-4 w-4" aria-hidden />} label="Meaningful changes" value={stats.meaningfulChanges} tone="text-green-600 dark:text-green-400" />
        <StatCard icon={<Bell className="h-4 w-4" aria-hidden />} label="Unread alerts" value={stats.unreadAlerts} tone="text-sky-600 dark:text-sky-400" />
        <StatCard icon={<CheckSquare className="h-4 w-4" aria-hidden />} label="Checks completed" value={stats.checksCompleted} />
        <StatCard icon={<MonitorX className="h-4 w-4" aria-hidden />} label="Needs attention" value={stats.attentionMonitors} tone="text-amber-600 dark:text-amber-400" />
        <StatCard icon={<ThumbsDown className="h-4 w-4" aria-hidden />} label="False-alert feedback" value={stats.falseAlertFeedback} />
      </div>

      {monitors.length === 0 ? (
        <EmptyState
          icon={<Activity className="h-8 w-8" aria-hidden />}
          title="No monitors yet"
          message="What happened: you have not created a monitor. Why it matters: PagePulse needs a URL and instruction before it can watch for meaningful changes. Next: start the Guided Demo on a fictional GPA page, create a monitor, or load sample lab monitors."
          action={
            <>
              <Button variant="primary" onClick={() => navigate('/demo')}>
                <Sparkles className="h-4 w-4" aria-hidden />
                Start Guided Demo
              </Button>
              <Button variant="primary" onClick={() => navigate('/monitors/new')}>
                <Plus className="h-4 w-4" aria-hidden />
                Create a monitor
              </Button>
              <Button onClick={loadSamples} busy={busyId === -1 && busyAction === 'samples'}>
                <FlaskConical className="h-4 w-4" aria-hidden />
                Load sample monitors
              </Button>
            </>
          }
        />
      ) : (
        <>
          {monitors.every((m) => m.checkFrequency === 'manual') && (
            <EmptyState
              title="No scheduled monitors"
              message="What happened: every monitor is set to manual-only checks. Why it matters: automatic polling will not run until a frequency is chosen. Next: edit a monitor and pick hourly/daily, or keep using Check now."
              action={
                <Button variant="primary" onClick={() => navigate(`/monitors/${monitors[0]!.id}`)}>
                  Open a monitor to schedule
                </Button>
              }
            />
          )}
        <ul className="space-y-3">
          {monitors.map((m) => (
            <li key={m.id}>
              <Card className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link to={`/monitors/${m.id}`} className="truncate text-base font-semibold hover:text-sky-700 hover:underline dark:hover:text-sky-400">
                        {m.name}
                      </Link>
                      {m.health ? (
                        <HealthBadge label={m.health.label} displayStatus={m.health.displayStatus} />
                      ) : (
                        <StatusBadge status={m.status} />
                      )}
                      {m.unreadCount > 0 && (
                        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                          {m.unreadCount} unread
                        </span>
                      )}
                    </div>
                    {m.health?.description && (
                      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{m.health.description}</p>
                    )}
                    <p className="mt-0.5 truncate text-sm text-zinc-500 dark:text-zinc-400">
                      {hostname(m.url)} · “{m.userIntent}”
                    </p>
                    {m.currentSummary && (
                      <p className="mt-1 truncate text-sm text-zinc-700 dark:text-zinc-300" title={m.currentSummary}>
                        Current: {m.currentSummary}
                      </p>
                    )}
                    {m.lastError && m.status !== 'healthy' && m.status !== 'changed' && (
                      <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">{m.lastError}</p>
                    )}
                    <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                      <div>
                        <dt className="inline font-medium">Section: </dt>
                        <dd className="inline">{m.monitoredSection || m.selectedSectionHeading || '—'}</dd>
                      </div>
                      <div>
                        <dt className="inline font-medium">Last successful check: </dt>
                        <dd className="inline">{formatRelative(m.lastSuccessfulCheckAt ?? m.lastCheckedAt)}</dd>
                      </div>
                      <div>
                        <dt className="inline font-medium">Next check: </dt>
                        <dd className="inline">{m.checkFrequency === 'manual' ? 'manual only' : formatRelative(m.nextCheckAt)}</dd>
                      </div>
                      <div>
                        <dt className="inline font-medium">Fetch duration: </dt>
                        <dd className="inline">{formatDurationMs(m.lastFetchDurationMs)}</dd>
                      </div>
                      <div>
                        <dt className="inline font-medium">Failures: </dt>
                        <dd className="inline">{m.failureCount}</dd>
                      </div>
                      <div>
                        <dt className="inline font-medium">Frequency: </dt>
                        <dd className="inline">{FREQUENCY_LABELS[m.checkFrequency]}</dd>
                      </div>
                      <div>
                        <dt className="inline font-medium">Versions: </dt>
                        <dd className="inline">{m.versionCount}</dd>
                      </div>
                      <div>
                        <dt className="inline font-medium">Meaningful changes: </dt>
                        <dd className="inline">{m.meaningfulChangeCount}</dd>
                      </div>
                    </dl>
                    <div className="mt-2">
                      <ConfidenceMeter value={m.confidence} label="Section-match confidence" />
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <Button className="min-h-10" onClick={() => runAction(m, 'check')} busy={busyId === m.id && busyAction === 'check'} title="Fetch the page and analyze it now">
                      <RefreshCw className="h-4 w-4" aria-hidden />
                      Check now
                    </Button>
                    <Button className="min-h-10" variant="ghost" onClick={() => navigate(`/monitors/${m.id}`)} title="View monitor details and versions">
                      <Eye className="h-4 w-4" aria-hidden />
                      View
                    </Button>
                    {m.status === 'paused' ? (
                      <Button className="min-h-10" variant="ghost" onClick={() => runAction(m, 'resume')} busy={busyId === m.id && busyAction === 'resume'}>
                        <Play className="h-4 w-4" aria-hidden />
                        Resume
                      </Button>
                    ) : (
                      <Button className="min-h-10" variant="ghost" onClick={() => runAction(m, 'pause')} busy={busyId === m.id && busyAction === 'pause'}>
                        <Pause className="h-4 w-4" aria-hidden />
                        Pause
                      </Button>
                    )}
                    <Button className="min-h-10 text-red-600 dark:text-red-400" variant="ghost" onClick={() => setDeleteTarget(m)} title="Delete this monitor">
                      <Trash2 className="h-4 w-4" aria-hidden />
                      <span className="sr-only">Delete {m.name}</span>
                    </Button>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
        </>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete monitor?"
        message={`This permanently deletes “${deleteTarget?.name}” along with its ${deleteTarget?.versionCount ?? 0} saved versions, changes, and alerts. This cannot be undone.`}
        confirmLabel="Delete monitor"
        busy={busyId === deleteTarget?.id && busyAction === 'delete'}
        onConfirm={() => deleteTarget && runAction(deleteTarget, 'delete')}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
