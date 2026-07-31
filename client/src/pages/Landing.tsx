import { Link } from 'react-router-dom';
import { Activity, ArrowRight, Eye, FileSearch, FlaskConical, Moon, ScanSearch, ShieldCheck, Sparkles, Sun, Target } from 'lucide-react';
import { useTheme } from '../components/Layout';

const FEATURES = [
  {
    icon: FileSearch,
    title: 'Evidence first',
    text: 'Every alert shows the exact old and new sentences, side by side, with the changed values highlighted. Nothing is invented.'
  },
  {
    icon: Target,
    title: 'Intent aware',
    text: 'Tell PagePulse what matters in plain English — a GPA cutoff, a deadline, a size coming back in stock — and it filters everything else out.'
  },
  {
    icon: ScanSearch,
    title: 'Noise resistant',
    text: 'Rewording, footer years, moved navigation, ads, and layout shuffles are recognized as harmless and never wake you up.'
  },
  {
    icon: ShieldCheck,
    title: 'Honest about uncertainty',
    text: 'When a page cannot be read or a section cannot be found confidently, PagePulse says so instead of guessing.'
  },
  {
    icon: FlaskConical,
    title: 'Measurably correct',
    text: 'A built-in Evaluation Lab runs controlled page mutations and reports recall, false-alert rate, and evidence accuracy.'
  },
  {
    icon: Eye,
    title: 'Transparent analysis',
    text: 'Structured and semantic change analysis that runs fully locally — extracted values, negation, similarity, and category rules you can inspect.'
  }
];

export default function Landing() {
  const [, setTheme] = useTheme();
  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2 font-semibold tracking-tight">
          <Activity className="h-5 w-5 text-sky-600 dark:text-sky-400" aria-hidden />
          PagePulse
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {isDark ? <Sun className="h-4 w-4" aria-hidden /> : <Moon className="h-4 w-4" aria-hidden />}
          </button>
          <Link to="/dashboard" className="text-sm font-medium text-sky-700 hover:underline dark:text-sky-400">
            Open dashboard
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-3xl px-6 pb-16 pt-14 text-center sm:pt-20">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Know when the information that <span className="text-sky-600 dark:text-sky-400">matters</span> changes.
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-lg text-zinc-600 dark:text-zinc-300">
          PagePulse monitors public webpages, filters out harmless noise, and shows the exact evidence behind every
          meaningful alert.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/monitors/new"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:bg-sky-500 dark:text-zinc-950 dark:hover:bg-sky-400"
          >
            Create a monitor
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          <Link
            to="/demo"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-sky-300 bg-sky-50 px-5 py-2.5 text-sm font-semibold text-sky-800 hover:bg-sky-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200 dark:hover:bg-sky-900"
          >
            <Sparkles className="h-4 w-4" aria-hidden />
            Start Guided Demo
          </Link>
          <Link
            to="/lab"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-zinc-300 bg-white px-5 py-2.5 text-sm font-semibold text-zinc-800 hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <FlaskConical className="h-4 w-4" aria-hidden />
            Try the evaluation lab
          </Link>
        </div>
        <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">
          “Alert me if the minimum transfer GPA changes.” · “Tell me if the scholarship deadline moves.” · “Notify me
          when this jacket is back in XL.”
        </p>
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-20">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <Icon className="h-5 w-5 text-sky-600 dark:text-sky-400" aria-hidden />
              <h2 className="mt-3 text-sm font-semibold">{title}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-zinc-200 py-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        PagePulse — a portfolio project by Manpreet Singh. Monitors public, server-rendered pages only; no logins,
        CAPTCHAs, or paywalls are bypassed.
      </footer>
    </div>
  );
}
