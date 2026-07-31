/**
 * Initialize the SQLite database (creates the schema if missing).
 * Usage: npm run db:init
 */
import { getDb } from '../db.js';
import { config } from '../config.js';

getDb();
console.log(`Database initialized in ${config.dbFile || config.dataDir}.`);
