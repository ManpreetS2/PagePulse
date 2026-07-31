import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center gap-4 py-24 text-center">
      <Compass className="h-10 w-10 text-zinc-400" aria-hidden />
      <h1 className="text-2xl font-bold tracking-tight">Page not found</h1>
      <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
        The page you were looking for doesn’t exist. It may have moved — and unlike webpages you monitor, we can’t alert
        you about this one.
      </p>
      <Link
        to="/dashboard"
        className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 dark:bg-sky-500 dark:text-zinc-950 dark:hover:bg-sky-400"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
