/** Small shared UI primitives: buttons, cards, badges, spinners, dialogs. */
import { useEffect, useRef, type ReactNode, type ButtonHTMLAttributes } from 'react';
import { AlertTriangle, CheckCircle2, Circle, Loader2, PauseCircle, ShieldAlert, XCircle, Zap } from 'lucide-react';
import type { MonitorStatus } from '../lib/types';
import { STATUS_LABELS, percent } from '../lib/format';

/* ---------------- Buttons ---------------- */

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-sky-600 text-white hover:bg-sky-700 disabled:bg-sky-600/50 dark:bg-sky-500 dark:hover:bg-sky-400 dark:text-zinc-950',
  secondary:
    'border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-600/50',
  ghost: 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
};

export function Button({
  variant = 'secondary',
  busy = false,
  className = '',
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; busy?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${className}`}
    >
      {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

/* ---------------- Cards ---------------- */

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900 ${className}`}>
      {children}
    </div>
  );
}

/* ---------------- Status badge ---------------- */

const STATUS_STYLES: Record<MonitorStatus, { classes: string; icon: ReactNode }> = {
  healthy: { classes: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900', icon: <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> },
  checking: { classes: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-900', icon: <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> },
  changed: { classes: 'bg-green-50 text-green-700 border-green-300 dark:bg-green-950 dark:text-green-300 dark:border-green-900', icon: <Zap className="h-3.5 w-3.5" aria-hidden /> },
  uncertain: { classes: 'bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900', icon: <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> },
  blocked: { classes: 'bg-orange-50 text-orange-700 border-orange-300 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-900', icon: <ShieldAlert className="h-3.5 w-3.5" aria-hidden /> },
  failed: { classes: 'bg-red-50 text-red-700 border-red-300 dark:bg-red-950 dark:text-red-300 dark:border-red-900', icon: <XCircle className="h-3.5 w-3.5" aria-hidden /> },
  paused: { classes: 'bg-zinc-100 text-zinc-600 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700', icon: <PauseCircle className="h-3.5 w-3.5" aria-hidden /> }
};

export function StatusBadge({ status }: { status: MonitorStatus }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.healthy;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${style.classes}`}>
      {style.icon}
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

/* ---------------- Confidence meter ---------------- */

export function ConfidenceMeter({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  const tone = value >= 0.7 ? 'bg-emerald-500' : value >= 0.4 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2" title={`${label}: ${percent(value)}`}>
      <div
        className="h-1.5 w-16 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700"
        role="meter"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{pct}%</span>
    </div>
  );
}

/* ---------------- Spinner + empty state ---------------- */

export function PageSpinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-zinc-500 dark:text-zinc-400" role="status" aria-live="polite">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ icon, title, message, action }: { icon?: ReactNode; title: string; message: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-zinc-300 px-6 py-14 text-center dark:border-zinc-700">
      <div className="text-zinc-400 dark:text-zinc-500">{icon ?? <Circle className="h-8 w-8" aria-hidden />}</div>
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="max-w-md text-sm text-zinc-500 dark:text-zinc-400">{message}</p>
      {action && <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

/* ---------------- Error banner ---------------- */

export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return (
    <div
      className="flex items-start justify-between gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
      role="alert"
    >
      <div className="flex items-start gap-2">
        <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>{message}</span>
      </div>
      {onDismiss && (
        <button onClick={onDismiss} className="text-red-600 underline hover:no-underline dark:text-red-300" type="button">
          Dismiss
        </button>
      )}
    </div>
  );
}

/* ---------------- Accessible modal dialog ---------------- */

export function Modal({
  open,
  title,
  children,
  onClose
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previouslyFocused?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-zinc-950/50" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
      >
        <h2 className="mb-3 text-lg font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  busy,
  onConfirm,
  onCancel
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal open={open} title={title} onClose={onCancel}>
      <p className="text-sm text-zinc-600 dark:text-zinc-300">{message}</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button variant="danger" onClick={onConfirm} busy={busy}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

/* ---------------- Evidence highlighting ---------------- */

/** Render text with the changed value highlighted via <mark>. */
export function HighlightedEvidence({ text, value }: { text: string; value: string }) {
  if (!text) return <span className="italic text-zinc-400 dark:text-zinc-500">(not present)</span>;
  // Composite values like "XL: Sold out" are highlighted part by part.
  const parts = value
    .split(/:\s*/)
    .map((p) => p.replace(/…$/, '').trim())
    .filter((p) => p.length > 0 && p.length < text.length);
  if (parts.length === 0) return <>{text}</>;

  // Build highlight ranges.
  const ranges: Array<[number, number]> = [];
  for (const part of parts) {
    const idx = text.toLowerCase().indexOf(part.toLowerCase());
    if (idx !== -1) ranges.push([idx, idx + part.length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r] as [number, number]);
  }
  if (merged.length === 0) return <>{text}</>;

  const nodes: ReactNode[] = [];
  let cursor = 0;
  merged.forEach(([start, end], i) => {
    if (start > cursor) nodes.push(<span key={`t${i}`}>{text.slice(cursor, start)}</span>);
    nodes.push(<mark key={`m${i}`}>{text.slice(start, end)}</mark>);
    cursor = end;
  });
  if (cursor < text.length) nodes.push(<span key="tail">{text.slice(cursor)}</span>);
  return <>{nodes}</>;
}

/** Side-by-side old/new evidence with highlighted changed values. */
export function EvidenceCompare({
  oldEvidence,
  newEvidence,
  oldValue,
  newValue
}: {
  oldEvidence: string;
  newEvidence: string;
  oldValue: string;
  newValue: string;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/60">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Before</div>
        <p className="text-sm leading-relaxed">
          <HighlightedEvidence text={oldEvidence} value={oldValue} />
        </p>
      </div>
      <div className="rounded-lg border border-sky-200 bg-sky-50/60 p-3 dark:border-sky-900 dark:bg-sky-950/40">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-sky-600 dark:text-sky-400">After</div>
        <p className="text-sm leading-relaxed">
          <HighlightedEvidence text={newEvidence} value={newValue} />
        </p>
      </div>
    </div>
  );
}
