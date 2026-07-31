import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, BellOff, CheckCheck, ExternalLink, Mail, MailOpen, ThumbsDown, ThumbsUp, Trash2 } from 'lucide-react';
import { del, get, post } from '../lib/api';
import type { Notification } from '../lib/types';
import { CATEGORY_LABELS, formatDateTime, percent } from '../lib/format';
import { Button, Card, EmptyState, ErrorBanner, EvidenceCompare, PageSpinner } from '../components/ui';

export default function Alerts() {
  const [notifications, setNotifications] = useState<Notification[] | null>(null);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');

  const load = useCallback(async () => {
    try {
      setNotifications(await get<Notification[]>('/api/notifications'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load alerts.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (fn: () => Promise<unknown>, message: string) => {
    setError('');
    try {
      await fn();
      setStatusMessage(message);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.');
    }
  };

  if (!notifications) return error ? <ErrorBanner message={error} /> : <PageSpinner label="Loading alerts…" />;

  const visible = filter === 'unread' ? notifications.filter((n) => !n.read) : notifications;
  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Alerts</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Evidence-backed notifications. {unreadCount > 0 ? `${unreadCount} unread.` : 'All caught up.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div role="group" aria-label="Filter alerts" className="flex rounded-lg border border-zinc-300 dark:border-zinc-700">
            {(['all', 'unread'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                aria-pressed={filter === f}
                className={`px-3 py-1.5 text-sm font-medium first:rounded-l-lg last:rounded-r-lg ${
                  filter === f ? 'bg-sky-600 text-white dark:bg-sky-500 dark:text-zinc-950' : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
                }`}
              >
                {f === 'all' ? 'All' : 'Unread'}
              </button>
            ))}
          </div>
          {unreadCount > 0 && (
            <Button onClick={() => act(() => post('/api/notifications/read-all'), 'All alerts marked read.')}>
              <CheckCheck className="h-4 w-4" aria-hidden />
              Mark all read
            </Button>
          )}
        </div>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}
      <p aria-live="polite" className="sr-only">{statusMessage}</p>

      {visible.length === 0 ? (
        <EmptyState
          icon={<BellOff className="h-8 w-8" aria-hidden />}
          title={filter === 'unread' ? 'No unread alerts' : 'No alerts yet'}
          message="PagePulse only alerts you when the monitored section changed meaningfully AND the change matches your instruction. Try the Evaluation Lab to see an alert being born."
          action={
            <Link to="/lab" className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 dark:bg-sky-500 dark:text-zinc-950">
              Open the Evaluation Lab
            </Link>
          }
        />
      ) : (
        <ul className="space-y-3">
          {visible.map((n) => (
            <li key={n.id}>
              <Card className={`space-y-3 p-4 ${n.read ? 'opacity-80' : 'border-sky-300 dark:border-sky-800'}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 items-start gap-2">
                    <Bell className={`mt-0.5 h-4 w-4 shrink-0 ${n.read ? 'text-zinc-400' : 'text-sky-600 dark:text-sky-400'}`} aria-hidden />
                    <div className="min-w-0">
                      <h2 className="text-sm font-semibold">{n.title}</h2>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        <Link to={`/monitors/${n.monitorId}`} className="hover:underline">
                          {n.monitorName}
                        </Link>{' '}
                        · {formatDateTime(n.createdAt)}
                        {n.change && <> · in “{n.change.sectionHeading}”</>}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      onClick={() => act(() => post(`/api/notifications/${n.id}/${n.read ? 'unread' : 'read'}`), n.read ? 'Marked unread.' : 'Marked read.')}
                      title={n.read ? 'Mark unread' : 'Mark read'}
                    >
                      {n.read ? <Mail className="h-4 w-4" aria-hidden /> : <MailOpen className="h-4 w-4" aria-hidden />}
                      <span className="sr-only">{n.read ? 'Mark unread' : 'Mark read'}</span>
                    </Button>
                    <Button
                      variant="ghost"
                      className="text-red-600 dark:text-red-400"
                      onClick={() => act(() => del(`/api/notifications/${n.id}`), 'Alert dismissed.')}
                      title="Dismiss this alert"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                      <span className="sr-only">Dismiss</span>
                    </Button>
                  </div>
                </div>

                {n.change ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                      <span className="rounded-full bg-green-100 px-2 py-0.5 font-medium text-green-800 dark:bg-green-950 dark:text-green-300">
                        {CATEGORY_LABELS[n.change.category] ?? n.change.category}
                      </span>
                      <span>Section match {percent(n.change.sectionConfidence)}</span>
                      <span>Meaning {percent(n.change.meaningConfidence)}</span>
                      <span>Intent match {percent(n.change.intentConfidence)}</span>
                    </div>
                    <EvidenceCompare
                      oldEvidence={n.change.oldEvidence}
                      newEvidence={n.change.newEvidence}
                      oldValue={n.change.oldValue}
                      newValue={n.change.newValue}
                    />
                    <p className="text-sm text-zinc-600 dark:text-zinc-300">{n.change.explanation}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={n.monitorUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:underline dark:text-sky-400"
                      >
                        Open source page
                        <ExternalLink className="h-3 w-3" aria-hidden />
                      </a>
                      <Link
                        to={`/monitors/${n.monitorId}/compare?old=${n.change.oldSnapshotId}&new=${n.change.newSnapshotId}`}
                        className="text-xs font-medium text-sky-700 hover:underline dark:text-sky-400"
                      >
                        View full version comparison
                      </Link>
                      <span className="mx-1 text-zinc-300 dark:text-zinc-600">·</span>
                      <Button
                        variant="ghost"
                        className={n.change.feedback === 'useful' ? 'text-green-600 dark:text-green-400' : ''}
                        onClick={() =>
                          act(
                            () => post(`/api/changes/${n.change!.id}/feedback`, { feedback: n.change!.feedback === 'useful' ? null : 'useful' }),
                            'Feedback recorded.'
                          )
                        }
                        aria-pressed={n.change.feedback === 'useful'}
                      >
                        <ThumbsUp className="h-4 w-4" aria-hidden />
                        Useful
                      </Button>
                      <Button
                        variant="ghost"
                        className={n.change.feedback === 'irrelevant' ? 'text-red-600 dark:text-red-400' : ''}
                        onClick={() =>
                          act(
                            () => post(`/api/changes/${n.change!.id}/feedback`, { feedback: n.change!.feedback === 'irrelevant' ? null : 'irrelevant' }),
                            'Feedback recorded — this monitor will be more selective.'
                          )
                        }
                        aria-pressed={n.change.feedback === 'irrelevant'}
                        title="Marks this alert as irrelevant and raises the monitor's relevance threshold"
                      >
                        <ThumbsDown className="h-4 w-4" aria-hidden />
                        Irrelevant
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-zinc-600 dark:text-zinc-300">{n.message}</p>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
