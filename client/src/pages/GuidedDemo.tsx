import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  FlaskConical,
  GitCompareArrows,
  Play,
  RotateCcw,
  Sparkles,
  Bell
} from 'lucide-react';
import { get, post } from '../lib/api';
import type { GuidedDemoResult } from '../lib/types';
import { CATEGORY_LABELS } from '../lib/format';
import { Button, Card, ConfidenceMeter, EmptyState, ErrorBanner, EvidenceCompare, PageSpinner } from '../components/ui';

const STEP_COPY: Record<string, { title: string; nextLabel: string }> = {
  idle: { title: 'Ready to start', nextLabel: 'Start Guided Demo' },
  baseline: { title: 'Baseline saved', nextLabel: 'Continue — apply equivalent rewording' },
  reword: { title: 'Rewording checked', nextLabel: 'Continue — apply unrelated deadline change' },
  unrelated: { title: 'Unrelated change ignored', nextLabel: 'Continue — apply GPA 3.20 → 3.40' },
  meaningful: { title: 'Meaningful change', nextLabel: 'Finish' },
  complete: { title: 'Demo complete', nextLabel: 'Return to Dashboard' }
};

export default function GuidedDemo() {
  const [demo, setDemo] = useState<GuidedDemoResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await get<GuidedDemoResult>('/api/demo');
      setDemo(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load demo status.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: 'start' | 'continue' | 'reset') => {
    setBusy(true);
    setError('');
    try {
      const result =
        action === 'start'
          ? await post<GuidedDemoResult>('/api/demo/start')
          : action === 'continue'
            ? await post<GuidedDemoResult>('/api/demo/continue')
            : await post<GuidedDemoResult>('/api/demo/reset');
      setDemo(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Demo action failed.');
    } finally {
      setBusy(false);
    }
  };

  if (!demo && !error) return <PageSpinner label="Loading guided demo…" />;
  if (!demo) return <ErrorBanner message={error} />;

  const step = demo.state.step;
  const copy = STEP_COPY[step] ?? STEP_COPY.idle;
  const alertChange = demo.outcome?.changes.find((c) => c.intentMatched === 1) ?? null;
  const quietChanges = demo.outcome?.changes.filter((c) => !c.intentMatched) ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Return to Dashboard
        </Link>
        <h1 className="mt-2 flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Sparkles className="h-6 w-6 text-sky-600 dark:text-sky-400" aria-hidden />
          Guided Demo
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
          A recruiter-friendly walkthrough on PagePulse’s fictional Transfer GPA lab page. Every step uses the real
          fetch → clean → match → diff → meaning → intent pipeline — no scripted animation.
        </p>
      </div>

      {error && <ErrorBanner message={error} />}

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Current step</p>
            <h2 className="text-lg font-semibold">{copy.title}</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300" role="status" aria-live="polite">
              {demo.explanation}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {step === 'idle' || step === 'complete' ? (
              <Button variant="primary" busy={busy} onClick={() => void run('start')}>
                <Play className="h-4 w-4" aria-hidden />
                Start Guided Demo
              </Button>
            ) : (
              <Button variant="primary" busy={busy} onClick={() => void run('continue')}>
                Continue
              </Button>
            )}
            <Button variant="secondary" busy={busy} onClick={() => void run('reset')}>
              <RotateCcw className="h-4 w-4" aria-hidden />
              Reset Demo
            </Button>
          </div>
        </div>

        <ol className="mt-5 grid gap-2 sm:grid-cols-5" aria-label="Demo progress">
          {[
            'Baseline',
            'Reword',
            'Unrelated',
            'GPA alert',
            'Done'
          ].map((label, i) => {
            const order = ['idle', 'baseline', 'reword', 'unrelated', 'complete'];
            const activeIdx = order.indexOf(step);
            const done = activeIdx > i || (step === 'complete' && i <= 4);
            return (
              <li
                key={label}
                className={`rounded-lg border px-2 py-2 text-center text-xs ${
                  done
                    ? 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200'
                    : 'border-zinc-200 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400'
                }`}
              >
                <span className="font-semibold">{i + 1}. {label}</span>
              </li>
            );
          })}
        </ol>
      </Card>

      {demo.monitor && (
        <Card className="p-5">
          <h2 className="text-sm font-semibold">Demo monitor</h2>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-zinc-500">Name</dt>
              <dd className="font-medium">{demo.monitor.name}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-zinc-500">Section</dt>
              <dd className="font-medium">{demo.monitor.selectedSectionHeading}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-zinc-500">Extracted GPA</dt>
              <dd className="font-medium tabular-nums">{demo.extractedGpa ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-zinc-500">Status</dt>
              <dd className="font-medium">{demo.monitor.health?.label ?? demo.monitor.status}</dd>
            </div>
          </dl>
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">“{demo.monitor.userIntent}”</p>
        </Card>
      )}

      {demo.outcome && (
        <Card className="space-y-4 p-5">
          <div className="flex items-start gap-2">
            {demo.outcome.alertsCreated > 0 ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden />
            ) : (
              <FlaskConical className="mt-0.5 h-5 w-5 text-sky-600 dark:text-sky-400" aria-hidden />
            )}
            <div>
              <h2 className="font-semibold">Check result</h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-300">{demo.outcome.message}</p>
              <p className="mt-1 text-xs text-zinc-500">Alerts created: {demo.outcome.alertsCreated}</p>
            </div>
          </div>

          {alertChange && (
            <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                  {CATEGORY_LABELS[alertChange.category] ?? alertChange.category}
                </span>
                <span className="text-lg font-semibold tabular-nums">
                  {alertChange.oldValue} → {alertChange.newValue}
                </span>
              </div>
              <EvidenceCompare
                oldEvidence={alertChange.oldEvidence}
                newEvidence={alertChange.newEvidence}
                oldValue={alertChange.oldValue}
                newValue={alertChange.newValue}
                oldLabel="Before"
                newLabel="After"
              />
              <p className="text-sm text-zinc-700 dark:text-zinc-300">{alertChange.explanation}</p>
              <div className="flex flex-wrap gap-4">
                <ConfidenceMeter value={alertChange.sectionConfidence} label="Section match" />
                <ConfidenceMeter value={alertChange.meaningConfidence} label="Meaningful change" />
                <ConfidenceMeter value={alertChange.intentConfidence} label="Intent match" />
              </div>
            </div>
          )}

          {quietChanges.length > 0 && !alertChange && (
            <div className="space-y-3">
              {quietChanges.slice(0, 2).map((c) => (
                <div key={c.id} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
                  <p className="text-xs font-medium text-zinc-500">
                    {CATEGORY_LABELS[c.category] ?? c.category}
                    {c.meaningful ? ' · not intent-matched' : ' · not meaningful'}
                  </p>
                  <EvidenceCompare
                    oldEvidence={c.oldEvidence}
                    newEvidence={c.newEvidence}
                    oldValue={c.oldValue}
                    newValue={c.newValue}
                  />
                  <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">{c.explanation}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {step === 'complete' && demo.state.monitorId && (
        <Card className="flex flex-wrap gap-2 p-4">
          {demo.state.notificationId && (
            <Link
              to="/alerts"
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700"
            >
              <Bell className="h-4 w-4" aria-hidden />
              Open Alert
            </Link>
          )}
          {demo.state.baselineSnapshotId && demo.state.latestSnapshotId && (
            <Link
              to={`/monitors/${demo.state.monitorId}/compare?old=${demo.state.baselineSnapshotId}&new=${demo.state.latestSnapshotId}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              <GitCompareArrows className="h-4 w-4" aria-hidden />
              View Version History
            </Link>
          )}
          <Link
            to={`/monitors/${demo.state.monitorId}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Open monitor detail
          </Link>
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Return to Dashboard
          </Link>
        </Card>
      )}

      {step === 'idle' && (
        <EmptyState
          title="No demo running"
          message="Start the guided demo to create a sample GPA monitor on a fictional lab page, then walk through rewording, an unrelated deadline change, and a real 3.20 → 3.40 requirement change."
          action={
            <Button variant="primary" busy={busy} onClick={() => void run('start')}>
              Start Guided Demo
            </Button>
          }
        />
      )}
    </div>
  );
}
