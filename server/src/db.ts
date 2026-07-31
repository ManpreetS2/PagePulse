import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS monitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  userIntent TEXT NOT NULL,
  intentJson TEXT NOT NULL DEFAULT '{}',
  selectedSectionHeading TEXT NOT NULL DEFAULT '',
  selectedSectionText TEXT NOT NULL DEFAULT '',
  extractedTargetType TEXT NOT NULL DEFAULT 'general',
  extractedTargetDescription TEXT NOT NULL DEFAULT '',
  checkFrequency TEXT NOT NULL DEFAULT 'daily',
  relevanceThreshold REAL NOT NULL DEFAULT 0.55,
  status TEXT NOT NULL DEFAULT 'healthy',
  pausedBeforeFailure TEXT,
  failureCount INTEGER NOT NULL DEFAULT 0,
  lastCheckedAt TEXT,
  nextCheckAt TEXT,
  lastError TEXT,
  lastFetchDurationMs INTEGER,
  lastCheckSummary TEXT NOT NULL DEFAULT 'never',
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  monitorId INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  retrievalTime TEXT NOT NULL DEFAULT (datetime('now')),
  pageTitle TEXT NOT NULL DEFAULT '',
  finalUrl TEXT NOT NULL DEFAULT '',
  sectionHeading TEXT NOT NULL DEFAULT '',
  cleanedSectionText TEXT NOT NULL DEFAULT '',
  normalizedText TEXT NOT NULL DEFAULT '',
  extractedFacts TEXT NOT NULL DEFAULT '[]',
  contentHash TEXT NOT NULL DEFAULT '',
  fetchStatus TEXT NOT NULL DEFAULT 'ok',
  fetchDetails TEXT NOT NULL DEFAULT '',
  sectionMatchConfidence REAL NOT NULL DEFAULT 1.0
);
CREATE INDEX IF NOT EXISTS idx_snapshots_monitor ON snapshots(monitorId, retrievalTime);

CREATE TABLE IF NOT EXISTS changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  monitorId INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  oldSnapshotId INTEGER NOT NULL,
  newSnapshotId INTEGER NOT NULL,
  category TEXT NOT NULL DEFAULT 'text_change',
  oldValue TEXT NOT NULL DEFAULT '',
  newValue TEXT NOT NULL DEFAULT '',
  oldEvidence TEXT NOT NULL DEFAULT '',
  newEvidence TEXT NOT NULL DEFAULT '',
  sectionHeading TEXT NOT NULL DEFAULT '',
  meaningful INTEGER NOT NULL DEFAULT 0,
  intentMatched INTEGER NOT NULL DEFAULT 0,
  sectionConfidence REAL NOT NULL DEFAULT 0,
  meaningConfidence REAL NOT NULL DEFAULT 0,
  intentConfidence REAL NOT NULL DEFAULT 0,
  explanation TEXT NOT NULL DEFAULT '',
  detectedAt TEXT NOT NULL DEFAULT (datetime('now')),
  feedback TEXT
);
CREATE INDEX IF NOT EXISTS idx_changes_monitor ON changes(monitorId, detectedAt);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  monitorId INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  changeId INTEGER REFERENCES changes(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  read INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS evaluation_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  suiteId TEXT NOT NULL DEFAULT '',
  scenarioId TEXT NOT NULL,
  scenarioName TEXT NOT NULL DEFAULT '',
  expectedResult TEXT NOT NULL,
  actualResult TEXT NOT NULL,
  correct INTEGER NOT NULL DEFAULT 0,
  sectionMatched INTEGER NOT NULL DEFAULT 0,
  intentMatched INTEGER NOT NULL DEFAULT 0,
  evidenceAccurate INTEGER NOT NULL DEFAULT 0,
  details TEXT NOT NULL DEFAULT '{}',
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lab_page_state (
  slug TEXT PRIMARY KEY,
  activeMutations TEXT NOT NULL DEFAULT '[]',
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  let file: string;
  if (config.dbFile === ':memory:') {
    file = ':memory:';
  } else if (config.dbFile) {
    file = config.dbFile;
    fs.mkdirSync(path.dirname(file), { recursive: true });
  } else {
    fs.mkdirSync(config.dataDir, { recursive: true });
    file = path.join(config.dataDir, 'pagepulse.db');
  }
  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  migrateSchema(db);
  return db;
}

/** Additive migrations for existing local databases (safe / idempotent). */
function migrateSchema(database: Database.Database): void {
  const columns = database.prepare('PRAGMA table_info(monitors)').all() as Array<{ name: string }>;
  const names = new Set(columns.map((c) => c.name));
  if (!names.has('lastFetchDurationMs')) {
    database.exec('ALTER TABLE monitors ADD COLUMN lastFetchDurationMs INTEGER');
  }
  if (!names.has('lastCheckSummary')) {
    database.exec("ALTER TABLE monitors ADD COLUMN lastCheckSummary TEXT NOT NULL DEFAULT 'never'");
  }
}

/** Close and forget the current connection (used by tests). */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function getSetting(key: string, fallback: string): string {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? fallback;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}
