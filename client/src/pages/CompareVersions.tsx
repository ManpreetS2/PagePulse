import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, GitCompareArrows } from 'lucide-react';
import { get } from '../lib/api';
import type { CompareResult } from '../lib/types';
import { CATEGORY_LABELS, formatDateTime, percent } from '../lib/format';
import { Card, ErrorBanner, EvidenceCompare, PageSpinner } from '../components/ui';

export default function CompareVersions() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const oldId = params.get('old');
  const newId = params.get('new');
  const [data, setData] = useState<CompareResult | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!oldId || !newId) {
      setError('Pick two versions to compare from the monitor page.');
      return;
    }
    get<CompareResult>(`/api/monitors/${id}/compare?old=${oldId}&new=${newId}`)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load comparison.'));
  }, [id, oldId, newId]);

  if (error) return (
    <div className="space-y-4">
      <Link to={`/monitors/${id}`} className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to monitor
      </Link>
      <ErrorBanner message={error} />
    </div>
  );
  if (!data) return <PageSpinner label="Loading comparison…" />;

  const meaningfulChanges = data.changes.filter((c) => c.meaning.meaningful);
  const otherChanges = data.changes.filter((c) => !c.meaning.meaningful);

  return (
    <div className="space-y-6">
      <div>
        <Link to={`/monitors/${id}`} className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to {data.monitor.name}
        </Link>
        <h1 className="mt-2 flex items-center gap-2 text-2xl font-bold tracking-tight">
          <GitCompareArrows className="h-6 w-6 text-sky-600 dark:text-sky-400" aria-hidden />
          Version comparison
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {formatDateTime(data.oldSnapshot.retrievalTime)} vs {formatDateTime(data.newSnapshot.retrievalTime)} · Instruction: “{data.monitor.userIntent}”
        </p>
      </div>

      {/* Full cleaned sections side by side */}
      <div className="grid gap-3 lg:grid-cols-2">
        {[
          { label: 'Older version', snap: data.oldSnapshot, tone: '' },
          { label: 'Newer version', snap: data.newSnapshot, tone: 'border-sky-200 dark:border-sky-900' }
        ].map(({ label, snap, tone }) => (
          <Card key={label} className={`p-4 ${tone}`}>
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</h2>
              <span className="text-xs text-zinc-400 dark:text-zinc-500">{formatDateTime(snap.retrievalTime)}</span>
            </div>
            <h3 className="mt-2 text-sm font-semibold">{snap.sectionHeading || '—'}</h3>
            <p className="mt-1 max-h-80 overflow-y-auto whitespace-pre-line text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
              {snap.cleanedSectionText || '(no readable content in this version)'}
            </p>
            {snap.extractedFacts.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={`Extracted values in ${label}`}>
                {snap.extractedFacts.slice(0, 10).map((f, i) => (
                  <li key={i} className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800" title={f.sentence}>
                    {f.type === 'availability' && f.context ? `${f.context}: ${f.value}` : f.raw}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>

      {/* Annotated changes */}
      <section aria-labelledby="compare-changes">
        <h2 id="compare-changes" className="mb-2 text-lg font-semibold">
          What changed ({data.changes.length})
        </h2>
        {data.changes.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 px-4 py-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            These two versions have identical monitored content.
          </p>
        ) : (
          <div className="space-y-3">
            {[...meaningfulChanges, ...otherChanges].map((c, i) => (
              <Card key={i} className="space-y-3 p-4">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      c.meaning.meaningful
                        ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300'
                        : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                    }`}
                  >
                    {CATEGORY_LABELS[c.category] ?? c.category}
                  </span>
                  <span className={c.meaning.meaningful ? 'font-medium text-green-700 dark:text-green-400' : 'text-zinc-500 dark:text-zinc-400'}>
                    {c.meaning.meaningful ? 'Meaningful' : 'Not meaningful'} ({percent(c.meaning.confidence)})
                  </span>
                  <span className={c.intentResult.matched ? 'font-medium text-sky-700 dark:text-sky-400' : 'text-zinc-500 dark:text-zinc-400'}>
                    {c.intentResult.matched ? 'Matches your instruction' : 'Not related to your instruction'} ({percent(c.intentResult.confidence)})
                  </span>
                </div>
                {(c.oldValue || c.newValue) && (
                  <p className="text-sm">
                    <span className="font-medium">{c.oldValue || '—'}</span>
                    <span className="mx-2 text-zinc-400">→</span>
                    <span className="font-medium">{c.newValue || '—'}</span>
                  </p>
                )}
                <EvidenceCompare
                  oldEvidence={c.oldEvidence}
                  newEvidence={c.newEvidence}
                  oldValue={c.oldValue}
                  newValue={c.newValue}
                  oldMeta={formatDateTime(data.oldSnapshot.retrievalTime)}
                  newMeta={formatDateTime(data.newSnapshot.retrievalTime)}
                />
                <div className="flex flex-wrap gap-4 text-xs text-zinc-500 dark:text-zinc-400">
                  <span>Meaningful-change confidence: {percent(c.meaning.confidence)}</span>
                  <span>Intent-match confidence: {percent(c.intentResult.confidence)}</span>
                </div>
                <p className="text-sm text-zinc-600 dark:text-zinc-300">
                  <span className="font-medium">Intent: </span>
                  {c.intentResult.reason}
                </p>
                <p className="text-sm text-zinc-600 dark:text-zinc-300">{c.meaning.explanation}</p>
              </Card>
            ))}
          </div>
        )}
      </section>

      {data.factSummary && (
        <section aria-labelledby="fact-summary" className="grid gap-3 lg:grid-cols-3">
          <Card className="p-4">
            <h2 id="fact-summary" className="text-sm font-semibold">
              Confirmed fact changes
            </h2>
            {data.factSummary.confirmedChanged.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-500">No typed fact values changed between these versions.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm">
                {data.factSummary.confirmedChanged.map((f, i) => (
                  <li key={i}>
                    <span className="font-medium capitalize">{f.type}</span>: {f.oldValue} → {f.newValue}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="p-4">
            <h2 className="text-sm font-semibold">Unchanged facts</h2>
            {data.factSummary.unchanged.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-500">No overlapping extracted facts.</p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {data.factSummary.unchanged.slice(0, 12).map((f, i) => (
                  <li key={i} className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">
                    {f.context ? `${f.context}: ${f.value}` : `${f.type}: ${f.value}`}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="p-4">
            <h2 className="text-sm font-semibold">Ignored unrelated changes</h2>
            {data.factSummary.ignoredUnrelated.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-500">Nothing was filtered as unrelated or not meaningful.</p>
            ) : (
              <ul className="mt-2 space-y-2 text-sm">
                {data.factSummary.ignoredUnrelated.slice(0, 6).map((f, i) => (
                  <li key={i} className="rounded-lg border border-zinc-200 p-2 dark:border-zinc-700">
                    <div className="font-medium">{CATEGORY_LABELS[f.category] ?? f.category}</div>
                    <div className="text-zinc-600 dark:text-zinc-300">{f.summary}</div>
                    <div className="text-xs text-zinc-500">{f.reason}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      )}
    </div>
  );
}
