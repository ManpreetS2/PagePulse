import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Activity, Bell, FlaskConical, LayoutDashboard, Menu, Moon, Plus, Settings, Sun, X } from 'lucide-react';
import { get } from '../lib/api';

type Theme = 'light' | 'dark' | 'system';

function applyTheme(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(() => (localStorage.getItem('pagepulse-theme') as Theme) || 'system');
  const setTheme = useCallback((t: Theme) => {
    localStorage.setItem('pagepulse-theme', t);
    setThemeState(t);
    applyTheme(t);
  }, []);
  useEffect(() => applyTheme(theme), [theme]);
  return [theme, setTheme];
}

function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const isDark = document.documentElement.classList.contains('dark');
  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={`Theme: ${theme}. Click to switch.`}
    >
      {isDark ? <Sun className="h-4 w-4" aria-hidden /> : <Moon className="h-4 w-4" aria-hidden />}
    </button>
  );
}

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/alerts', label: 'Alerts', icon: Bell },
  { to: '/lab', label: 'Evaluation Lab', icon: FlaskConical },
  { to: '/settings', label: 'Settings', icon: Settings }
];

export default function Layout() {
  const [unread, setUnread] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    let alive = true;
    const load = () => {
      get<{ count: number }>('/api/notifications/unread-count')
        .then((r) => alive && setUnread(r.count))
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [location.pathname]);

  const navLinks = NAV_ITEMS.map(({ to, label, icon: Icon }) => (
    <NavLink
      key={to}
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
          isActive
            ? 'bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300'
            : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
        }`
      }
    >
      <Icon className="h-4 w-4" aria-hidden />
      <span className="flex-1">{label}</span>
      {label === 'Alerts' && unread > 0 && (
        <span
          className="rounded-full bg-sky-600 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white dark:bg-sky-500 dark:text-zinc-950"
          aria-label={`${unread} unread alerts`}
        >
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </NavLink>
  ));

  return (
    <div className="min-h-screen lg:flex">
      {/* Sidebar (desktop) */}
      <aside className="hidden w-60 shrink-0 border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 lg:flex lg:flex-col">
        <div className="flex items-center justify-between px-4 py-4">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <Activity className="h-5 w-5 text-sky-600 dark:text-sky-400" aria-hidden />
            PagePulse
          </Link>
          <ThemeToggle />
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3" aria-label="Main navigation">
          {navLinks}
        </nav>
        <div className="p-3">
          <Link
            to="/monitors/new"
            className="flex items-center justify-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700 dark:bg-sky-500 dark:text-zinc-950 dark:hover:bg-sky-400"
          >
            <Plus className="h-4 w-4" aria-hidden />
            New monitor
          </Link>
        </div>
      </aside>

      {/* Top bar (mobile) */}
      <div className="flex flex-col lg:hidden">
        <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <Activity className="h-5 w-5 text-sky-600 dark:text-sky-400" aria-hidden />
            PagePulse
          </Link>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <button
              type="button"
              className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              onClick={() => setMobileOpen((o) => !o)}
              aria-expanded={mobileOpen}
              aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
            >
              {mobileOpen ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
            </button>
          </div>
        </header>
        {mobileOpen && (
          <nav className="flex flex-col gap-1 border-b border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900" aria-label="Main navigation">
            {navLinks}
            <Link
              to="/monitors/new"
              className="mt-1 flex items-center justify-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700 dark:bg-sky-500 dark:text-zinc-950"
            >
              <Plus className="h-4 w-4" aria-hidden />
              New monitor
            </Link>
          </nav>
        )}
      </div>

      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-6xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
