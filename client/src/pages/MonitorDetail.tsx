import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Clock, ExternalLink, GitCompareArrows, Pause, Pencil, Play, RefreshCw,
  ThumbsDown, ThumbsUp, Trash2, Zap
} from 'lucide-react';
import { ApiError, del, formatApiError, get, patch, post } from '../lib/api';
import type { Change, CheckFrequency, CheckOutcome, Monitor, Snapshot } from '../lib/types';
import { CATEGORY_LABELS, FIELD_LABELS, FREQUENCY_LABELS, TRIGGER_LABELS, formatDateTime, formatRelative, percent } from '../lib/format';
import { Button, Card, ConfidenceMeter, ConfirmDialog, EmptyState, ErrorBanner, EvidenceCompare, HealthBadge, Modal, PageSpinner, QuietReportPanel, StatusBadge } from '../components/ui';
import { formatDurationMs } from '../lib/monitorHealth';

interface MonitorDetailData extends Monitor {
  latestSnapshot: Snapshot | null;
}

export default function MonitorDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [monitor, setMonitor] = useState<MonitorDetailData | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [changes, setChanges] = useState<Change[]>([]);
  const [error, setError] = useState('');
  const [busyAction, setBusyAction] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [compareSelection, setCompareSelection] = useState<number[]>([]);

  // Edit form state
  const [editName, setEditName] = useState('');
  const [editIntent, setEditIntent] = useState('');
  const [editFrequency, setEditFrequency] = useState<CheckFrequency>('daily');
  const [editThreshold, setEditThreshold] = useState(0.55);

  const load = useCallback(async () => {
    try {
      const [m, snaps, ch] = await Promise.all([
        get<MonitorDetailData>(`/api/monitors/${id}`),
        get<Snapshot[]>(`/api/monitors/${id}/snapshots`),
        get<Change[]>(`/api/monitors/${id}/changes`)
      ]);
      setMonitor(m);
      setSnapshots(snaps);
      setChanges(ch);
      setEditName(m.name);
      setEditIntent(m.userIntent);
      setEditFrequency(m.checkFrequency);
      setEditThreshold(m.relevanceThreshold);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load monitor.');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = async (action: 'check' | 'pause' | 'resume' | 'delete') => {
    if (!monitor) return;
    // Ignore double-clicks while a check (or other action) is already in flight.
    if (busyAction) return;
    setBusyAction(action);
    setError('');
    try {
      if (action === 'check') {
        setStatusMessage('Checking the page now…');
        const outcome = await post<CheckOutcome>(`/api/monitors/${monitor.id}/check`);
        setStatusMessage(outcome.quietReport?.summary || outcome.message);
      } else if (action === 'delete') {
        await del(`/api/monitors/${monitor.id}`);
        navigate('/dashboard');
        return;
      } else {
        await post(`/api/monitors/${monitor.id}/${action}`);
        setStatusMessage(action === 'pause' ? 'Monitor paused.' : 'Monitor resumed.');
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
      setBusyAction('');
    }
  };

  const saveEdit = async () => {
    if (!monitor) return;
    setBusyAction('edit');
    try {
      await patch(`/api/monitors/${monitor.id}`, {
        name: editName,
        userIntent: editIntent,
        checkFrequency: editFrequency,
        relevanceThreshold: editThreshold
      });
      setEditOpen(false);
      setStatusMessage('Monitor updated.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save changes.');
    } finally {
      setBusyAction('');
    }
  };

  const sendFeedback = async (change: Change, feedback: 'useful' | 'irrelevant') => {
    try {
      await post(`/api/changes/${change.id}/feedback`, { feedback: change.feedback === feedback ? null : feedback });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record feedback.');
    }
  };

  const toggleCompare = (snapshotId: number) => {
    setCompareSelection((sel) => {
      if (sel.includes(snapshotId)) return sel.filter((x) => x !== snapshotId);
      return [...sel, snapshotId].slice(-2);
    });
  };

  const compareHref = useMemo(() => {
    if (compareSelection.length !== 2) return null;
    const [a, b] = [...compareSelection].sort((x, y) => x - y);
    return `/monitors/${id}/compare?old=${a}&new=${b}`;
  }, [compareSelection, id]);

  if (!monitor) return error ? <ErrorBanner message={error} /> : <PageSpinner label="Loading monitor…" />;

  const intent = monitor.intent;
  const latestFacts = monitor.latestSnapshot?.extractedFacts ?? [];

  return (
    <div className="space-y-6">
      <Link to="/dashboard" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to dashboard
      </Link>

      {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}
      <p aria-live="polite" className="sr-only">{statusMessage}</p>
      {statusMessage && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm text-sky-800 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200">
          {statusMessage}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{monitor.name}</h1>
            {monitor.health ? (
              <HealthBadge label={monitor.health.label} displayStatus={monitor.health.displayStatus} />
            ) : (
              <StatusBadge status={monitor.status} />
            )}
          </div>
          {monitor.health?.description && (
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{monitor.health.description}</p>
          )}
          <a
            href={monitor.url}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 break-all text-sm text-sky-700 hover:underline dark:text-sky-400"
          >
            {monitor.url}
            <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
          </a>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">“{monitor.userIntent}”</p>
          {monitor.lastError && monitor.status !== 'healthy' && monitor.status !== 'changed' && (
            <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">{monitor.lastError}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button variant="primary" onClick={() => runAction('check')} busy={busyAction === 'check'}>
            <RefreshCw className="h-4 w-4" aria-hidden />
            Check now
          </Button>
          <Button onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4" aria-hidden />
            Edit
          </Button>
          {monitor.status === 'paused' ? (
            <Button onClick={() => runAction('resume')} busy={busyAction === 'resume'}>
              <Play className="h-4 w-4" aria-hidden />
              Resume
            </Button>
          ) : (
            <Button onClick={() => runAction('pause')} busy={busyAction === 'pause'}>
              <Pause className="h-4 w-4" aria-hidden />
              Pause
            </Button>
          )}
          <Button variant="ghost" className="text-red-600 dark:text-red-400" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="h-4 w-4" aria-hidden />
            Delete
          </Button>
        </div>
      </div>

      {monitor.latestQuietReport && (
        <QuietReportPanel report={monitor.latestQuietReport} />
      )}

      {/* Info cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Monitored section</h2>
          <p className="mt-1 text-sm font-medium">{monitor.selectedSectionHeading || '—'}</p>
          <p className="mt-1 max-h-32 overflow-y-auto whitespace-pre-line text-sm text-zinc-600 dark:text-zinc-300">
            {monitor.selectedSectionText || 'No section text stored.'}
          </p>
          <div className="mt-2">
            <ConfidenceMeter value={monitor.confidence} label="Section-match confidence" />
          </div>
        </Card>
        <Card className="p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Intent interpretation</h2>
          <dl className="mt-1 space-y-1 text-sm">
            <div>
              <dt className="inline text-zinc-500 dark:text-zinc-400">Category: </dt>
              <dd className="inline font-medium">{FIELD_LABELS[intent.field] ?? intent.field}</dd>
            </div>
            <div>
              <dt className="inline text-zinc-500 dark:text-zinc-400">Trigger: </dt>
              <dd className="inline font-medium">{TRIGGER_LABELS[intent.trigger] ?? intent.trigger}</dd>
            </div>
            {intent.variant && (
              <div>
                <dt className="inline text-zinc-500 dark:text-zinc-400">Variant: </dt>
                <dd className="inline font-medium">{intent.variant}</dd>
              </div>
            )}
            <div>
              <dt className="inline text-zinc-500 dark:text-zinc-400">Keywords: </dt>
              <dd className="inline">{intent.keywords.join(', ') || '—'}</dd>
            </div>
            <div>
              <dt className="inline text-zinc-500 dark:text-zinc-400">Relevance threshold: </dt>
              <dd className="inline">{percent(monitor.relevanceThreshold)}</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">Edit the instruction to change this interpretation.</p>
        </Card>
        <Card className="p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Health & schedule</h2>
          <dl className="mt-1 space-y-1 text-sm">
            <div>
              <dt className="inline text-zinc-500 dark:text-zinc-400">Frequency: </dt>
              <dd className="inline">{FREQUENCY_LABELS[monitor.checkFrequency]}</dd>
            </div>
            <div>
              <dt className="inline text-zinc-500 dark:text-zinc-400">Last successful check: </dt>
              <dd className="inline">{formatRelative(monitor.lastSuccessfulCheckAt ?? monitor.lastCheckedAt)}</dd>
            </div>
            <div>
              <dt className="inline text-zinc-500 dark:text-zinc-400">Next check: </dt>
              <dd className="inline">{monitor.checkFrequency === 'manual' ? 'manual only' : formatRelative(monitor.nextCheckAt)}</dd>
            </div>
            <div>
              <dt className="inline text-zinc-500 dark:text-zinc-400">Last fetch duration: </dt>
              <dd className="inline">{formatDurationMs(monitor.lastFetchDurationMs)}</dd>
            </div>
            <div>
              <dt className="inline text-zinc-500 dark:text-zinc-400">Consecutive failures: </dt>
              <dd className="inline">{monitor.failureCount}</dd>
            </div>
            {monitor.latestExtractedValue && (
              <div>
                <dt className="inline text-zinc-500 dark:text-zinc-400">Latest value: </dt>
                <dd className="inline">{monitor.latestExtractedValue}</dd>
              </div>
            )}
          </dl>
          {latestFacts.length > 0 && (
            <>
              <h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Current extracted values</h3>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {latestFacts.slice(0, 8).map((f, i) => (
                  <li key={i} className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800" title={f.sentence}>
                    {f.type === 'availability' && f.context ? `${f.context}: ${f.value}` : f.raw}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>

      {/* Detected changes */}
      <section aria-labelledby="changes-heading">
        <h2 id="changes-heading" className="mb-2 flex items-center gap-2 text-lg font-semibold">
          <Zap className="h-5 w-5 text-green-600 dark:text-green-400" aria-hidden />
          Detected changes
        </h2>
        {changes.length === 0 ? (
          <EmptyState
            title="No changes yet"
            message="What happened: this monitor has not recorded a section change. Why it matters: alerts only appear after a check finds a meaningful, intent-matched difference. Next: mutate a lab page or wait for the live page to change, then run Check now."
            action={
              <Button variant="primary" onClick={() => runAction('check')} busy={busyAction === 'check'}>
                <RefreshCw className="h-4 w-4" aria-hidden />
                Check now
              </Button>
            }
          />
        ) : (
          <ul className="space-y-3">
            {changes.map((c) => (
              <li key={c.id}>
                <Card className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          c.meaningful && c.intentMatched
                            ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300'
                            : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                        }`}
                      >
                        {CATEGORY_LABELS[c.category] ?? c.category}
                      </span>
                      <span className="text-zinc-500 dark:text-zinc-400">{formatDateTime(c.detectedAt)}</span>
                      <span className="text-zinc-500 dark:text-zinc-400">in “{c.sectionHeading}”</span>
                      {!(c.meaningful && c.intentMatched) && (
                        <span className="text-xs text-zinc-400 dark:text-zinc-500">(no alert — {c.meaningful ? 'did not match your instruction' : 'judged not meaningful'})</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        onClick={() => sendFeedback(c, 'useful')}
                        className={c.feedback === 'useful' ? 'text-green-600 dark:text-green-400' : ''}
                        title="Mark this detection as useful"
                        aria-pressed={c.feedback === 'useful'}
                      >
                        <ThumbsUp className="h-4 w-4" aria-hidden />
                        Useful
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => sendFeedback(c, 'irrelevant')}
                        className={c.feedback === 'irrelevant' ? 'text-red-600 dark:text-red-400' : ''}
                        title="Mark this detection as irrelevant (raises this monitor's relevance threshold)"
                        aria-pressed={c.feedback === 'irrelevant'}
                      >
                        <ThumbsDown className="h-4 w-4" aria-hidden />
                        Irrelevant
                      </Button>
                    </div>
                  </div>
                  {(c.oldValue || c.newValue) && (
                    <p className="text-sm">
                      <span className="font-medium">{c.oldValue || '—'}</span>
                      <span className="mx-2 text-zinc-400">→</span>
                      <span className="font-medium">{c.newValue || '—'}</span>
                    </p>
                  )}
                  <EvidenceCompare oldEvidence={c.oldEvidence} newEvidence={c.newEvidence} oldValue={c.oldValue} newValue={c.newValue} />
                  <p className="text-sm text-zinc-600 dark:text-zinc-300">{c.explanation}</p>
                  <div className="flex flex-wrap gap-x-6 gap-y-1">
                    <div className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                      Section <ConfidenceMeter value={c.sectionConfidence} label="Section confidence" />
                    </div>
                    <div className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                      Meaning <ConfidenceMeter value={c.meaningConfidence} label="Meaning confidence" />
                    </div>
                    <div className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                      Intent <ConfidenceMeter value={c.intentConfidence} label="Intent-match confidence" />
                    </div>
                    <Link
                      to={`/monitors/${monitor.id}/compare?old=${c.oldSnapshotId}&new=${c.newSnapshotId}`}
                      className="text-xs font-medium text-sky-700 hover:underline dark:text-sky-400"
                    >
                      View full version comparison
                    </Link>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Version timeline */}
      <section aria-labelledby="versions-heading">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 id="versions-heading" className="flex items-center gap-2 text-lg font-semibold">
            <Clock className="h-5 w-5 text-zinc-500" aria-hidden />
            Version history
          </h2>
          {compareHref ? (
            <Link
              to={compareHref}
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700 dark:bg-sky-500 dark:text-zinc-950"
            >
              <GitCompareArrows className="h-4 w-4" aria-hidden />
              Compare selected
            </Link>
          ) : (
            <span className="text-xs text-zinc-500 dark:text-zinc-400">Select two versions to compare ({compareSelection.length}/2)</span>
          )}
        </div>
        <Card className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {snapshots.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title="No snapshots yet"
                message="What happened: PagePulse has not stored a successful or failed fetch for this monitor. Why it matters: version history and evidence comparison require at least one snapshot. Next: run Check now to capture the current page."
                action={
                  <Button variant="primary" onClick={() => runAction('check')} busy={busyAction === 'check'}>
                    <RefreshCw className="h-4 w-4" aria-hidden />
                    Check now
                  </Button>
                }
              />
            </div>
          ) : (
            snapshots.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <input
                type="checkbox"
                checked={compareSelection.includes(s.id)}
                onChange={() => toggleCompare(s.id)}
                aria-label={`Select version from ${formatDateTime(s.retrievalTime)} for comparison`}
                className="accent-sky-600"
              />
              <span className="w-36 shrink-0 tabular-nums text-zinc-600 dark:text-zinc-300">{formatDateTime(s.retrievalTime)}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  s.fetchStatus === 'ok'
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                    : 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
                }`}
              >
                {s.fetchStatus}
              </span>
              <span className="min-w-0 flex-1 truncate text-zinc-500 dark:text-zinc-400">
                {s.sectionHeading || '—'}
                {s.changeSummary && s.changeSummary.total > 0 && (
                  <span className="ml-2 text-xs">
                    {s.changeSummary.total} change{s.changeSummary.total === 1 ? '' : 's'}
                    {s.changeSummary.alerts > 0 && <span className="text-green-600 dark:text-green-400"> · {s.changeSummary.alerts} alerted</span>}
                  </span>
                )}
              </span>
              <span className="font-mono text-xs text-zinc-400 dark:text-zinc-500" title="Content hash">
                {s.contentHash ? s.contentHash.slice(0, 8) : '—'}
              </span>
            </div>
          ))
          )}
        </Card>
      </section>

      {/* Edit dialog */}
      <Modal open={editOpen} title="Edit monitor" onClose={() => setEditOpen(false)}>
        <div className="space-y-3">
          <div>
            <label htmlFor="edit-name" className="mb-1 block text-sm font-medium">
              Name
            </label>
            <input
              id="edit-name"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              maxLength={120}
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            />
          </div>
          <div>
            <label htmlFor="edit-intent" className="mb-1 block text-sm font-medium">
              Monitoring instruction
            </label>
            <textarea
              id="edit-intent"
              value={editIntent}
              onChange={(e) => setEditIntent(e.target.value)}
              rows={2}
              maxLength={500}
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            />
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">The structured interpretation is re-derived when you change this.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="edit-frequency" className="mb-1 block text-sm font-medium">
                Check frequency
              </label>
              <select
                id="edit-frequency"
                value={editFrequency}
                onChange={(e) => setEditFrequency(e.target.value as CheckFrequency)}
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
              >
                {Object.entries(FREQUENCY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="edit-threshold" className="mb-1 block text-sm font-medium">
                Relevance threshold: {percent(editThreshold)}
              </label>
              <input
                id="edit-threshold"
                type="range"
                min={0.2}
                max={0.9}
                step={0.05}
                value={editThreshold}
                onChange={(e) => setEditThreshold(Number(e.target.value))}
                className="w-full accent-sky-600"
              />
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Higher = fewer, more certain alerts.</p>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={saveEdit} busy={busyAction === 'edit'}>
              Save changes
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete monitor?"
        message={`This permanently deletes “${monitor.name}” along with its saved versions, changes, and alerts. This cannot be undone.`}
        confirmLabel="Delete monitor"
        busy={busyAction === 'delete'}
        onConfirm={() => runAction('delete')}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
