import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Globe, ListChecks, Save, ScanSearch, Sparkles } from 'lucide-react';
import { get, post } from '../lib/api';
import type { CheckFrequency, IntentTrigger, Monitor, PreviewResult, TargetType } from '../lib/types';
import { FIELD_LABELS, FREQUENCY_LABELS, TRIGGER_LABELS, formatDateTime, percent } from '../lib/format';
import { Button, Card, ConfidenceMeter, ErrorBanner } from '../components/ui';

const EXAMPLE_INTENTS = [
  'Alert me if the minimum transfer GPA changes.',
  'Tell me if the scholarship deadline moves.',
  'Notify me when this jacket becomes available in XL.',
  'Tell me if the event location changes.',
  'Alert me if this return policy becomes more restrictive.'
];

const STEPS = ['URL & intent', 'Fetch & inspect', 'Select section', 'Confirm baseline', 'Save'];

export default function CreateMonitor() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Step 1 fields
  const [url, setUrl] = useState(params.get('url') ?? '');
  const [name, setName] = useState(params.get('name') ?? '');
  const [intentText, setIntentText] = useState(params.get('intent') ?? '');

  // Step 2-3 state
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [sectionIndex, setSectionIndex] = useState<number | null>(null);
  const [showAllSections, setShowAllSections] = useState(false);

  // Step 4 overrides
  const [field, setField] = useState<TargetType>('general');
  const [trigger, setTrigger] = useState<IntentTrigger>('any_change');
  const [variant, setVariant] = useState('');

  // Step 5
  const [frequency, setFrequency] = useState<CheckFrequency>('daily');

  useEffect(() => {
    get<{ defaultFrequency: CheckFrequency }>('/api/settings')
      .then((s) => setFrequency(s.defaultFrequency))
      .catch(() => {});
  }, []);

  const runPreview = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await post<PreviewResult>('/api/preview', { url, userIntent: intentText });
      setPreview(result);
      if (result.fetch.status !== 'ok') {
        const detail = result.fetch.details || 'Unknown fetch problem.';
        const guidance =
          result.fetch.status === 'blocked'
            ? ' What happened: the URL is private, unsupported, or blocked. Why it matters: PagePulse only fetches public http(s) HTML. Next: use a public page or an Evaluation Lab URL.'
            : result.fetch.status === 'timeout'
              ? ' What happened: the request timed out. Why it matters: slow or unreachable pages cannot be checked reliably. Next: retry later or choose a lighter page.'
              : result.fetch.status === 'unsupported'
                ? ' What happened: the response was not HTML/text. Why it matters: PDFs and binary downloads are not supported. Next: point the monitor at an HTML page.'
                : result.fetch.status === 'network_error'
                  ? ' What happened: DNS or network failed. Why it matters: PagePulse could not reach the host. Next: check the hostname spelling or try a lab page.'
                  : ' Why it matters: without a successful fetch, PagePulse cannot create a baseline. Next: fix the URL or try an Evaluation Lab page.';
        setError(`This page cannot be monitored (${result.fetch.status}): ${detail}.${guidance}`);
        setStep(1);
        return;
      }
      if (result.page.sections.length === 0) {
        setError(
          'What happened: the page was fetched but almost no readable text was found. Why it matters: JavaScript-heavy shells without server-rendered content leave nothing to monitor. Next: use a server-rendered page or an Evaluation Lab page.'
        );
        setStep(1);
        return;
      }
      setSectionIndex(result.ranked[0]?.index ?? 0);
      setField(result.intent.field);
      setTrigger(result.intent.trigger);
      setVariant(result.intent.variant ?? '');
      setStep(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed.');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!preview || sectionIndex === null) return;
    setBusy(true);
    setError('');
    try {
      const section = preview.page.sections[sectionIndex];
      const monitor = await post<Monitor>('/api/monitors', {
        name,
        url,
        userIntent: intentText,
        checkFrequency: frequency,
        sectionHeading: section?.heading,
        sectionIndex,
        intentOverrides: {
          field,
          trigger,
          variant: variant.trim() ? variant.trim() : null
        }
      });
      navigate(`/monitors/${monitor.id}`, { state: { created: true } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the monitor.');
    } finally {
      setBusy(false);
    }
  };

  const selectedSection = useMemo(
    () => (preview && sectionIndex !== null ? preview.page.sections[sectionIndex] ?? null : null),
    [preview, sectionIndex]
  );
  const topCandidates = useMemo(() => (preview ? preview.ranked.slice(0, 3) : []), [preview]);

  const canContinueStep1 = url.trim().length > 3 && name.trim().length > 0 && intentText.trim().length >= 3;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link to="/dashboard" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Create a monitor</h1>
      </div>

      {/* Step indicator */}
      <ol className="flex flex-wrap items-center gap-2 text-xs" aria-label="Progress">
        {STEPS.map((label, i) => (
          <li key={label} className="flex items-center gap-2">
            <span
              aria-current={i === step ? 'step' : undefined}
              className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${
                i < step
                  ? 'bg-sky-600 text-white dark:bg-sky-500 dark:text-zinc-950'
                  : i === step
                    ? 'border-2 border-sky-600 text-sky-700 dark:border-sky-400 dark:text-sky-300'
                    : 'border border-zinc-300 text-zinc-400 dark:border-zinc-700 dark:text-zinc-500'
              }`}
            >
              {i < step ? <Check className="h-3.5 w-3.5" aria-hidden /> : i + 1}
            </span>
            <span className={i === step ? 'font-medium' : 'text-zinc-500 dark:text-zinc-400'}>{label}</span>
            {i < STEPS.length - 1 && <span className="text-zinc-300 dark:text-zinc-600">—</span>}
          </li>
        ))}
      </ol>

      {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}

      {/* Step 1: URL + intent */}
      {step === 0 && (
        <Card className="space-y-4 p-5">
          <div>
            <label htmlFor="url" className="mb-1 block text-sm font-medium">
              Webpage URL
            </label>
            <input
              id="url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.edu/admissions/transfer"
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            />
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              A public, server-rendered page. Pages behind logins, CAPTCHAs, or paywalls cannot be monitored.
            </p>
          </div>
          <div>
            <label htmlFor="name" className="mb-1 block text-sm font-medium">
              Monitor name
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Transfer GPA requirement"
              maxLength={120}
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            />
          </div>
          <div>
            <label htmlFor="intent" className="mb-1 block text-sm font-medium">
              What should PagePulse watch for?
            </label>
            <textarea
              id="intent"
              value={intentText}
              onChange={(e) => setIntentText(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Alert me if the minimum transfer GPA changes."
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            />
            <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Example instructions">
              {EXAMPLE_INTENTS.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setIntentText(ex)}
                  className="rounded-full border border-zinc-300 px-2.5 py-1 text-xs text-zinc-600 hover:border-sky-400 hover:text-sky-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-sky-600 dark:hover:text-sky-300"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end">
            <Button variant="primary" onClick={runPreview} disabled={!canContinueStep1} busy={busy}>
              Fetch page
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </Card>
      )}

      {/* Step 2: fetch result + inspection */}
      {step === 1 && preview && (
        <Card className="space-y-4 p-5">
          <div className="flex items-start gap-3">
            <Globe className="mt-0.5 h-5 w-5 text-sky-600 dark:text-sky-400" aria-hidden />
            <div className="min-w-0">
              <h2 className="font-semibold">{preview.page.title || 'Untitled page'}</h2>
              <p className="truncate text-sm text-zinc-500 dark:text-zinc-400">{preview.fetch.finalUrl}</p>
              <dl className="mt-2 grid gap-x-6 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400 sm:grid-cols-2">
                <div>
                  <dt className="inline font-medium">Fetch status: </dt>
                  <dd className="inline">{preview.fetch.status === 'ok' ? `OK (HTTP ${preview.fetch.httpStatus})` : preview.fetch.status}</dd>
                </div>
                <div>
                  <dt className="inline font-medium">Retrieved: </dt>
                  <dd className="inline">{formatDateTime(preview.retrievalTime)}</dd>
                </div>
                <div>
                  <dt className="inline font-medium">Readable sections: </dt>
                  <dd className="inline">{preview.page.sections.length}</dd>
                </div>
                <div>
                  <dt className="inline font-medium">Details: </dt>
                  <dd className="inline">{preview.fetch.details}</dd>
                </div>
              </dl>
            </div>
          </div>
          {preview.fetch.status === 'ok' && preview.page.sections.length > 0 ? (
            <>
              <div className="max-h-72 overflow-y-auto rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/50">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Cleaned page preview</h3>
                {preview.page.sections.map((s, i) => (
                  <div key={i} className="mb-3">
                    <h4 className="text-sm font-semibold">{s.heading}</h4>
                    <p className="whitespace-pre-line text-sm text-zinc-600 dark:text-zinc-300">
                      {s.text.length > 400 ? s.text.slice(0, 400) + '…' : s.text}
                    </p>
                  </div>
                ))}
              </div>
              <div className="flex justify-between">
                <Button onClick={() => setStep(0)}>
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                  Back
                </Button>
                <Button variant="primary" onClick={() => setStep(2)}>
                  Choose section
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            </>
          ) : (
            <div className="flex justify-start">
              <Button onClick={() => setStep(0)}>
                <ArrowLeft className="h-4 w-4" aria-hidden />
                Back and fix the URL
              </Button>
            </div>
          )}
        </Card>
      )}

      {/* Step 3: section selection */}
      {step === 2 && preview && (
        <Card className="space-y-4 p-5">
          <div className="flex items-start gap-3">
            <ScanSearch className="mt-0.5 h-5 w-5 text-sky-600 dark:text-sky-400" aria-hidden />
            <div>
              <h2 className="font-semibold">Which section should PagePulse watch?</h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                These are the sections most likely to match “{intentText}”. Pick one, or browse all sections.
              </p>
            </div>
          </div>
          <fieldset>
            <legend className="sr-only">Candidate sections</legend>
            <div className="space-y-2">
              {(showAllSections ? preview.page.sections.map((_, i) => ({ index: i, confidence: preview.ranked.find((r) => r.index === i)?.confidence ?? 0, reason: preview.ranked.find((r) => r.index === i)?.reason ?? '' })) : topCandidates).map((cand) => {
                const s = preview.page.sections[cand.index]!;
                const selected = sectionIndex === cand.index;
                return (
                  <label
                    key={cand.index}
                    className={`block cursor-pointer rounded-lg border p-3 transition-colors ${
                      selected
                        ? 'border-sky-500 bg-sky-50/60 dark:border-sky-500 dark:bg-sky-950/40'
                        : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-700 dark:hover:border-zinc-600'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-sm font-semibold">
                        <input
                          type="radio"
                          name="section"
                          checked={selected}
                          onChange={() => setSectionIndex(cand.index)}
                          className="accent-sky-600"
                        />
                        {s.heading}
                      </span>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">match {percent(cand.confidence)}</span>
                    </div>
                    <p className="mt-1 line-clamp-3 whitespace-pre-line pl-6 text-sm text-zinc-600 dark:text-zinc-300">{s.text}</p>
                    {cand.reason && <p className="mt-1 pl-6 text-xs text-zinc-400 dark:text-zinc-500">Why: {cand.reason}</p>}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <button
            type="button"
            onClick={() => setShowAllSections((v) => !v)}
            className="text-sm font-medium text-sky-700 hover:underline dark:text-sky-400"
          >
            {showAllSections ? 'Show top candidates only' : `Browse all ${preview.page.sections.length} sections`}
          </button>
          <div className="flex justify-between">
            <Button onClick={() => setStep(1)}>
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Back
            </Button>
            <Button variant="primary" onClick={() => setStep(3)} disabled={sectionIndex === null}>
              Continue
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </Card>
      )}

      {/* Step 4: baseline confirmation + intent interpretation */}
      {step === 3 && preview && selectedSection && (
        <Card className="space-y-4 p-5">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 h-5 w-5 text-sky-600 dark:text-sky-400" aria-hidden />
            <div>
              <h2 className="font-semibold">Confirm the baseline</h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                This is what PagePulse will save as the first version and compare against later.
              </p>
            </div>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/50">
            <h3 className="text-sm font-semibold">{selectedSection.heading}</h3>
            <p className="mt-1 max-h-48 overflow-y-auto whitespace-pre-line text-sm text-zinc-600 dark:text-zinc-300">{selectedSection.text}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="field" className="mb-1 block text-sm font-medium">
                Detected category
              </label>
              <select
                id="field"
                value={field}
                onChange={(e) => setField(e.target.value as TargetType)}
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
              >
                {Object.entries(FIELD_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="trigger" className="mb-1 block text-sm font-medium">
                Alert when it…
              </label>
              <select
                id="trigger"
                value={trigger}
                onChange={(e) => setTrigger(e.target.value as IntentTrigger)}
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
              >
                {Object.entries(TRIGGER_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="variant" className="mb-1 block text-sm font-medium">
                Specific variant <span className="font-normal text-zinc-400">(optional)</span>
              </label>
              <input
                id="variant"
                type="text"
                value={variant}
                onChange={(e) => setVariant(e.target.value)}
                placeholder="e.g. XL"
                maxLength={60}
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
              />
            </div>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Instruction: “{intentText}” · Keywords PagePulse matched: {preview.intent.keywords.join(', ') || '—'}
          </p>
          <div className="flex justify-between">
            <Button onClick={() => setStep(2)}>
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Back
            </Button>
            <Button variant="primary" onClick={() => setStep(4)}>
              Continue
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </Card>
      )}

      {/* Step 5: frequency + save */}
      {step === 4 && preview && selectedSection && (
        <Card className="space-y-4 p-5">
          <div className="flex items-start gap-3">
            <ListChecks className="mt-0.5 h-5 w-5 text-sky-600 dark:text-sky-400" aria-hidden />
            <div>
              <h2 className="font-semibold">How often should PagePulse check?</h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Scheduled checks run while the PagePulse server is running. You can always use “Check now”.
              </p>
            </div>
          </div>
          <fieldset>
            <legend className="sr-only">Check frequency</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(Object.keys(FREQUENCY_LABELS) as CheckFrequency[]).map((f) => (
                <label
                  key={f}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm ${
                    frequency === f
                      ? 'border-sky-500 bg-sky-50/60 dark:border-sky-500 dark:bg-sky-950/40'
                      : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-700 dark:hover:border-zinc-600'
                  }`}
                >
                  <input type="radio" name="frequency" checked={frequency === f} onChange={() => setFrequency(f)} className="accent-sky-600" />
                  {FREQUENCY_LABELS[f]}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-700">
            <p>
              <span className="font-medium">{name}</span> will watch the “{selectedSection.heading}” section of{' '}
              <span className="break-all text-zinc-500 dark:text-zinc-400">{preview.fetch.finalUrl}</span> and alert you for: “{intentText}”.
            </p>
            <div className="mt-2">
              <ConfidenceMeter value={topCandidates.find((c) => c.index === sectionIndex)?.confidence ?? 0} label="Section relevance confidence" />
            </div>
          </div>
          <div className="flex justify-between">
            <Button onClick={() => setStep(3)}>
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Back
            </Button>
            <Button variant="primary" onClick={save} busy={busy}>
              <Save className="h-4 w-4" aria-hidden />
              Save monitor & baseline
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
