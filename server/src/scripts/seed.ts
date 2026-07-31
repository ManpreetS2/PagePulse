/**
 * Seed script: initializes the database and resets every Evaluation Lab
 * page to its baseline. Sample monitors are loaded from the UI (Dashboard →
 * "Load sample monitors") because they need the running server to fetch
 * its own lab pages.
 * Usage: npm run db:seed
 */
import { getDb } from '../db.js';
import { LAB_PAGES, setActiveMutations } from '../lab/pages.js';

getDb();
for (const page of LAB_PAGES) {
  setActiveMutations(page.slug, []);
  console.log(`Lab page "${page.slug}" reset to baseline.`);
}
console.log('Seed complete. Start the app and use "Load sample monitors" on the dashboard for demo data.');
