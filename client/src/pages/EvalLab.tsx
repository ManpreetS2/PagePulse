import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CheckCircle2, ExternalLink, FlaskConical, Play, Plus, RotateCcw, XCircle } from 'lucide-react';
import { formatApiError, get, post } from '../lib/api';
import type { EvalScenario, LabPage, SuiteReport } from '../lib/types';
import { formatDateTime, percent } from '../lib/format';
import { Button, Card, EmptyState, ErrorBanner, PageSpinner } from '../components/ui';

function MetricCard({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <Card className="p-4">
      <div className={`text-2xl font-bold tabular-nums ${tone ?? ''}`}>{value}</div>
      <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</div>
      {hint && <div className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">{hint}</div>}
    </Card>
  );
}

export default function EvalLab() {
  const [pages, setPages] = useState<LabPage[] | null>(null);
  const [scenarios, setScenarios] = useState<EvalScenario[]>([]);
  const [report, setReport] = useState<SuiteReport | null>(null);
  const [error, setError] = useState('');
  const [busySlug, setBusySlug] = useState('');
  const [running, setRunning] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, s, r] = await Promise.all([
        get<LabPage[]>('/api/lab/pages'),
        get<EvalScenario[]>('/api/evaluation/scenarios'),
        get<SuiteReport | null>('/api/evaluation/latest')
      ]);
      setPages(p);
      setScenarios(s);
      setReport(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the lab.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleMutation = async (page: LabPage, mutationId: string) => {
    setBusySlug(page.slug);
    setError('');
    try {
      const next = page.activeMutations.includes(mutationId)
        ? page.activeMutations.filter((m) => m !== mutationId)
        : [...page.activeMutations, mutationId];
      await post(`/api/lab/pages/${page.slug}/mutations`, { mutations: next });
      await load();
    } catch (err) {
      setError(formatApiError(err, 'Could not apply the mutation.'));
    } finally {
      setBusySlug('');
    }
  };

  const resetPage = async (page: LabPage) => {
    setBusySlug(page.slug);
    setError('');
    try {
      await post(`/api/lab/pages/${page.slug}/reset`);
      setStatusMessage(`“${page.name}” reset to baseline.`);
      await load();
    } catch (err) {
      setError(formatApiError(err, 'Could not reset the page.'));
    } finally {
      setBusySlug('');
    }
  };

  const runSuiteNow = async () => {
    if (running) return;
    setRunning(true);
    setError('');
    setStatusMessage('Running the complete evaluation suite — every scenario creates a real monitor, mutates the page, and runs the full pipeline…');
    try {
      const r = await post<SuiteReport>('/api/evaluation/run');
      setReport(r);
      setStatusMessage(`Suite finished: ${r.metrics.passed}/${r.metrics.totalScenarios} scenarios passed.`);
      await load();
    } catch (err) {
      setError(formatApiError(err, 'The evaluation run failed.'));
      setStatusMessage('');
    } finally {
      setRunning(false);
    }
  };

  if (!pages) return error ? <ErrorBanner message={error} /> : <PageSpinner label="Loading the Evaluation Lab…" />;

  const metrics = report?.metrics ?? null;
  const chartData = metrics
    ? [
        { name: 'Recall', value: (metrics.recall ?? 0) * 100 },
        { name: 'False-alert rate', value: (metrics.falseAlertRate ?? 0) * 100 },
        { name: 'Section tracking', value: (metrics.sectionTrackingAccuracy ?? 0) * 100 },
        { name: 'Intent accuracy', value: (metrics.intentMatchAccuracy ?? 0) * 100 },
        { name: 'Evidence accuracy', value: (metrics.evidenceAccuracy ?? 0) * 100 }
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <FlaskConical className="h-6 w-6 text-sky-600 dark:text-sky-400" aria-hidden />
            Evaluation Lab
          </h1>
          <p className="max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
            Three controlled webpages served by PagePulse itself. Apply mutations, run checks, and measure — with
            deterministic scenarios — whether meaningful changes are caught and harmless noise is ignored.
          </p>
        </div>
        <Button variant="primary" onClick={runSuiteNow} busy={running}>
          <Play className="h-4 w-4" aria-hidden />
          Run complete evaluation suite
        </Button>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}
      <p aria-live="polite" className={statusMessage ? 'rounded-lg border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm text-sky-800 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200' : 'sr-only'}>
        {statusMessage}
      </p>

      {/* Guided demo */}
      <Card className="p-4">
        <h2 className="text-sm font-semibold">Try the workflow by hand</h2>
        <ol className="mt-2 grid list-inside list-decimal gap-1 text-sm text-zinc-600 dark:text-zinc-300 sm:grid-cols-2 lg:grid-cols-5">
          <li>Reset a test page to its baseline.</li>
          <li>Create a monitor for it (button below).</li>
          <li>Apply one or more mutations here.</li>
          <li>Use “Check now” on the monitor.</li>
          <li>See whether an alert was (or wasn’t) raised — with evidence.</li>
        </ol>
      </Card>

      {/* Lab pages */}
      <div className="grid gap-4 lg:grid-cols-3">
        {pages.map((page) => (
          <Card key={page.slug} className="flex flex-col p-4">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-sm font-semibold">{page.name}</h2>
              <a
                href={page.url}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-sky-700 hover:underline dark:text-sky-400"
                aria-label={`Open ${page.name} in a new tab`}
              >
                <ExternalLink className="h-4 w-4" aria-hidden />
              </a>
            </div>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{page.description}</p>
            <div className="mt-3 space-y-1.5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Mutations ({page.activeMutations.length} active)
              </h3>
              <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
                {page.mutations.map((m) => (
                  <label key={m.id} className="flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/60" title={m.description}>
                    <input
                      type="checkbox"
                      checked={page.activeMutations.includes(m.id)}
                      onChange={() => toggleMutation(page, m.id)}
                      disabled={busySlug === page.slug}
                      className="mt-0.5 accent-sky-600"
                    />
                    <span className="min-w-0 flex-1">
                      {m.label}
                      <span
                        className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                          m.kind === 'meaningful'
                            ? 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300'
                            : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                        }`}
                      >
                        {m.kind}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
              <Button onClick={() => resetPage(page)} busy={busySlug === page.slug}>
                <RotateCcw className="h-4 w-4" aria-hidden />
                Reset to baseline
              </Button>
              <Link
                to={`/monitors/new?url=${encodeURIComponent(page.url)}&name=${encodeURIComponent(page.name)}&intent=${encodeURIComponent(page.suggestedIntent)}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                <Plus className="h-4 w-4" aria-hidden />
                Create monitor
              </Link>
            </div>
          </Card>
        ))}
      </div>

      {/* Metrics */}
      <section aria-labelledby="metrics-heading">
        <h2 id="metrics-heading" className="mb-2 text-lg font-semibold">
          Evaluation results
        </h2>
        {!report || !metrics ? (
          <EmptyState
            icon={<FlaskConical className="h-8 w-8" aria-hidden />}
            title="No Evaluation Lab results yet"
            message={`What happened: the deterministic suite has not been run in this database. Why it matters: the lab is how you prove recall, false-alert rate, and evidence accuracy on controlled pages. Next: run all ${scenarios.length || 'available'} scenarios in the complete evaluation suite.`}
            action={
              <Button variant="primary" onClick={runSuiteNow} busy={running}>
                <Play className="h-4 w-4" aria-hidden />
                Run complete evaluation suite
              </Button>
            }
          />
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Last run {formatDateTime(report.finishedAt)} · {metrics.totalScenarios} scenarios · Note: these metrics come from{' '}
              {metrics.totalScenarios} controlled scenarios — a meaningful smoke test of the pipeline, not a large-scale benchmark.
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <MetricCard label="Scenarios passed" value={`${metrics.passed}/${metrics.totalScenarios}`} tone={metrics.failed === 0 ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'} />
              <MetricCard label="Meaningful-change recall" value={percent(metrics.recall)} hint={`${metrics.meaningfulCaught}/${metrics.meaningfulTotal} caught`} />
              <MetricCard label="False-alert rate" value={percent(metrics.falseAlertRate)} hint={`${metrics.falseAlerts}/${metrics.quietTotal} quiet scenarios`} tone={metrics.falseAlerts === 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'} />
              <MetricCard label="Section tracking" value={percent(metrics.sectionTrackingAccuracy)} />
              <MetricCard label="Intent accuracy" value={percent(metrics.intentMatchAccuracy)} />
              <MetricCard label="Evidence accuracy" value={percent(metrics.evidenceAccuracy)} hint="Quoted values appear verbatim in evidence" />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              {/* Confusion matrix */}
              <Card className="p-4">
                <h3 className="mb-3 text-sm font-semibold">Confusion matrix</h3>
                <table className="w-full text-center text-sm">
                  <thead>
                    <tr className="text-xs text-zinc-500 dark:text-zinc-400">
                      <th scope="col" className="p-2 text-left font-medium"></th>
                      <th scope="col" className="p-2 font-medium">Alerted</th>
                      <th scope="col" className="p-2 font-medium">Stayed quiet</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th scope="row" className="p-2 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400">Meaningful change</th>
                      <td className="rounded-lg bg-green-50 p-2 font-semibold text-green-700 dark:bg-green-950 dark:text-green-300">
                        {metrics.confusion.truePositives} correct
                      </td>
                      <td className={`p-2 font-semibold ${metrics.confusion.falseNegatives > 0 ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300' : 'text-zinc-400'}`}>
                        {metrics.confusion.falseNegatives} missed
                      </td>
                    </tr>
                    <tr>
                      <th scope="row" className="p-2 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400">Harmless / irrelevant</th>
                      <td className={`p-2 font-semibold ${metrics.confusion.falsePositives > 0 ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300' : 'text-zinc-400'}`}>
                        {metrics.confusion.falsePositives} false alerts
                      </td>
                      <td className="rounded-lg bg-green-50 p-2 font-semibold text-green-700 dark:bg-green-950 dark:text-green-300">
                        {metrics.confusion.trueNegatives} correct
                      </td>
                    </tr>
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">
                  Faithfulness proxy: {percent(metrics.faithfulness)} of produced alerts quote values that appear verbatim in the page evidence.
                </p>
              </Card>

              {/* Chart */}
              <Card className="p-4">
                <h3 className="mb-3 text-sm font-semibold">Metric overview (%)</h3>
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: -18 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-zinc-200 dark:text-zinc-700" />
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} stroke="currentColor" />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} stroke="currentColor" />
                      <Tooltip formatter={(v) => `${Math.round(Number(v))}%`} contentStyle={{ fontSize: 12 }} />
                      <Bar dataKey="value" fill="#0284c7" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>

            {/* Per-scenario results: table on desktop, cards on mobile */}
            <Card className="overflow-hidden">
              <h3 className="border-b border-zinc-200 p-4 text-sm font-semibold dark:border-zinc-800">
                Scenario results ({report.results.length})
              </h3>
              {/* Desktop table */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                      <th scope="col" className="p-3 font-medium">Scenario</th>
                      <th scope="col" className="p-3 font-medium">Kind</th>
                      <th scope="col" className="p-3 font-medium">Expected</th>
                      <th scope="col" className="p-3 font-medium">Actual</th>
                      <th scope="col" className="p-3 font-medium">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.results.map((r) => (
                      <tr
                        key={r.scenarioId}
                        className="cursor-pointer border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40"
                        onClick={() => setExpanded(expanded === r.scenarioId ? null : r.scenarioId)}
                      >
                        <td className="p-3">
                          {r.scenarioName}
                          {expanded === r.scenarioId && (
                            <div className="mt-2 space-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                              <p>Pipeline: {r.details.checkMessage}</p>
                              <p>Tracked section: “{r.details.trackedSection}”</p>
                              {r.details.alertingChanges.map((c, i) => (
                                <p key={i}>
                                  Alert: {c.oldValue || '—'} → {c.newValue || '—'} (“{c.oldEvidence}” → “{c.newEvidence}”)
                                </p>
                              ))}
                              {r.details.error && <p className="text-red-600 dark:text-red-400">Error: {r.details.error}</p>}
                            </div>
                          )}
                        </td>
                        <td className="p-3 capitalize text-zinc-500 dark:text-zinc-400">{r.kind}</td>
                        <td className="p-3">{r.expected === 'alert' ? 'Alert' : 'No alert'}</td>
                        <td className="p-3">{r.actual === 'alert' ? 'Alert' : r.actual === 'no_alert' ? 'No alert' : r.actual}</td>
                        <td className="p-3">
                          {r.correct ? (
                            <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-400">
                              <CheckCircle2 className="h-4 w-4" aria-hidden /> Pass
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-400">
                              <XCircle className="h-4 w-4" aria-hidden /> Fail
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Mobile stacked cards */}
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800 md:hidden">
                {report.results.map((r) => (
                  <li key={r.scenarioId} className="space-y-1 p-4 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{r.scenarioName}</span>
                      {r.correct ? (
                        <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-400">
                          <CheckCircle2 className="h-4 w-4" aria-hidden /> Pass
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-400">
                          <XCircle className="h-4 w-4" aria-hidden /> Fail
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {r.kind} · expected {r.expected === 'alert' ? 'alert' : 'no alert'} · got {r.actual === 'no_alert' ? 'no alert' : r.actual}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        )}
      </section>
    </div>
  );
}
