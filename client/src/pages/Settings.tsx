import { useCallback, useEffect, useState } from 'react';
import { Info, Mail, MailX, Save, Trash2 } from 'lucide-react';
import { get, post, put } from '../lib/api';
import type { CheckFrequency, Settings } from '../lib/types';
import { FREQUENCY_LABELS, percent } from '../lib/format';
import { useTheme } from '../components/Layout';
import { Button, Card, ConfirmDialog, ErrorBanner, PageSpinner } from '../components/ui';

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [theme, setTheme] = useTheme();

  const [defaultFrequency, setDefaultFrequency] = useState<CheckFrequency>('daily');
  const [threshold, setThreshold] = useState(0.55);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);

  const load = useCallback(async () => {
    try {
      const s = await get<Settings>('/api/settings');
      setSettings(s);
      setDefaultFrequency(s.defaultFrequency);
      setThreshold(s.defaultRelevanceThreshold);
      setNotificationsEnabled(s.notificationsEnabled);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await put('/api/settings', {
        defaultFrequency,
        defaultRelevanceThreshold: threshold,
        notificationsEnabled,
        theme
      });
      setStatusMessage('Settings saved.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save settings.');
    } finally {
      setBusy(false);
    }
  };

  const resetData = async () => {
    setBusy(true);
    setError('');
    try {
      await post('/api/settings/reset-data');
      setConfirmReset(false);
      setStatusMessage('All monitors, versions, changes, alerts, and evaluation results were deleted. Lab pages were reset to baseline.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset data.');
    } finally {
      setBusy(false);
    }
  };

  if (!settings) return error ? <ErrorBanner message={error} /> : <PageSpinner label="Loading settings…" />;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Defaults, appearance, notifications, and data.</p>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}
      <p aria-live="polite" className={statusMessage ? 'rounded-lg border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm text-sky-800 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200' : 'sr-only'}>
        {statusMessage}
      </p>

      <Card className="space-y-4 p-5">
        <h2 className="text-sm font-semibold">Monitoring defaults</h2>
        <div>
          <label htmlFor="default-frequency" className="mb-1 block text-sm font-medium">
            Default check frequency
          </label>
          <select
            id="default-frequency"
            value={defaultFrequency}
            onChange={(e) => setDefaultFrequency(e.target.value as CheckFrequency)}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          >
            {Object.entries(FREQUENCY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Scheduled checks run only while the PagePulse server process is running.
          </p>
        </div>
        <div>
          <label htmlFor="default-threshold" className="mb-1 block text-sm font-medium">
            Default relevance threshold: {percent(threshold)}
          </label>
          <input
            id="default-threshold"
            type="range"
            min={0.2}
            max={0.9}
            step={0.05}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="w-full accent-sky-600"
          />
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            How strongly a change must match your instruction before it becomes an alert. Higher = fewer, more certain alerts.
          </p>
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="text-sm font-semibold">Appearance</h2>
        <fieldset>
          <legend className="mb-1 block text-sm font-medium">Theme</legend>
          <div className="flex gap-2">
            {(['light', 'dark', 'system'] as const).map((t) => (
              <label
                key={t}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm capitalize ${
                  theme === t
                    ? 'border-sky-500 bg-sky-50/60 dark:border-sky-500 dark:bg-sky-950/40'
                    : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-700 dark:hover:border-zinc-600'
                }`}
              >
                <input type="radio" name="theme" checked={theme === t} onChange={() => setTheme(t)} className="accent-sky-600" />
                {t}
              </label>
            ))}
          </div>
        </fieldset>
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="text-sm font-semibold">Notifications</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={notificationsEnabled}
            onChange={(e) => setNotificationsEnabled(e.target.checked)}
            className="accent-sky-600"
          />
          Create in-app alerts for meaningful changes
        </label>
        <div
          className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${
            settings.email.configured
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
              : 'border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300'
          }`}
        >
          {settings.email.configured ? <Mail className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <MailX className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
          <div>
            <p className="font-medium">{settings.email.configured ? 'Email delivery enabled' : 'Email delivery disabled'}</p>
            <p className="text-xs">{settings.email.note}</p>
          </div>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button variant="primary" onClick={save} busy={busy}>
          <Save className="h-4 w-4" aria-hidden />
          Save settings
        </Button>
      </div>

      <Card className="space-y-3 p-5">
        <h2 className="text-sm font-semibold text-red-700 dark:text-red-400">Danger zone</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          Delete every monitor, saved version, detected change, alert, and evaluation result, and reset the lab pages.
        </p>
        <Button variant="danger" onClick={() => setConfirmReset(true)}>
          <Trash2 className="h-4 w-4" aria-hidden />
          Reset all data
        </Button>
      </Card>

      <Card className="space-y-3 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Info className="h-4 w-4 text-sky-600 dark:text-sky-400" aria-hidden />
          About PagePulse
        </h2>
        <div className="space-y-2 text-sm text-zinc-600 dark:text-zinc-300">
          <p>
            PagePulse is an evidence-first monitoring platform for meaningful changes on public webpages, built as a
            portfolio project by <span className="font-medium">Manpreet Singh</span>, Computer Science student at De Anza College.
          </p>
          <p>
            <span className="font-medium">Change analysis engine:</span> {settings.comparisonEngine.description} A provider
            interface exists so a hosted language model can be plugged in later, but nothing here calls an external AI
            service.
          </p>
          <p>
            <span className="font-medium">Honest limitations:</span> only public, server-rendered pages are supported.
            PagePulse never bypasses logins, CAPTCHAs, paywalls, or anti-bot protections, and it does not execute page
            JavaScript. Scheduled checks require the server process to keep running.
          </p>
        </div>
      </Card>

      <ConfirmDialog
        open={confirmReset}
        title="Reset all data?"
        message="This permanently deletes every monitor, saved version, change, alert, and evaluation result, and resets the lab pages to baseline. This cannot be undone."
        confirmLabel="Reset all data"
        busy={busy}
        onConfirm={resetData}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  );
}
