import { createApp } from './app.js';
import { config, emailConfigured } from './config.js';
import { getDb } from './db.js';
import { recoverStuckCheckingMonitors } from './lib/stuckChecks.js';
import { setSelfOrigin } from './selfOrigin.js';
import { startScheduler } from './scheduler.js';

getDb(); // Initialize the database (creates schema on first run).

// Any monitor left in `checking` from a previous process must be recovered
// before the scheduler starts, or it would be skipped forever.
const startupRecovery = recoverStuckCheckingMonitors(0);
if (startupRecovery.recoveredIds.length > 0) {
  console.warn(`[startup] recovered stuck checking monitors: ${startupRecovery.recoveredIds.join(', ')}`);
}

const app = createApp();
const server = app.listen(config.port, () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : config.port;
  setSelfOrigin(`http://127.0.0.1:${port}`);
  startScheduler();
  console.log(`PagePulse server running at http://127.0.0.1:${port}`);
  console.log(`Email notifications: ${emailConfigured() ? 'SMTP configured' : 'disabled (in-app alerts only)'}`);
  console.log('Note: scheduled checks run only while this server process is running.');
});
