import { Component, type ReactNode } from 'react';
import { Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import Landing from './pages/Landing';
import Dashboard from './pages/Dashboard';
import CreateMonitor from './pages/CreateMonitor';
import MonitorDetail from './pages/MonitorDetail';
import CompareVersions from './pages/CompareVersions';
import Alerts from './pages/Alerts';
import EvalLab from './pages/EvalLab';
import SettingsPage from './pages/Settings';
import NotFound from './pages/NotFound';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto mt-24 max-w-md rounded-xl border border-red-300 bg-red-50 p-6 text-center dark:border-red-900 dark:bg-red-950">
          <h1 className="text-lg font-semibold text-red-800 dark:text-red-200">Something went wrong</h1>
          <p className="mt-2 text-sm text-red-700 dark:text-red-300">{this.state.error.message}</p>
          <button
            type="button"
            className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
            onClick={() => {
              this.setState({ error: null });
              window.location.href = '/dashboard';
            }}
          >
            Back to dashboard
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route element={<Layout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/monitors/new" element={<CreateMonitor />} />
          <Route path="/monitors/:id" element={<MonitorDetail />} />
          <Route path="/monitors/:id/compare" element={<CompareVersions />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/lab" element={<EvalLab />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}
