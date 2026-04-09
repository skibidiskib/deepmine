import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { join } from 'path';
import type {
  GlobalStats,
  User,
  Run,
  Discovery,
  TimelineEntry,
  SubmitPayload,
} from './types';

// Data directory: use DEEPMINE_DATA_DIR env var if set, otherwise fall back to ./data
// On production, set DEEPMINE_DATA_DIR=/home/ubuntu/deepmine-data to keep DB outside app dir
const dataDir = process.env.DEEPMINE_DATA_DIR || join(process.cwd(), 'data');
mkdirSync(dataDir, { recursive: true });

const dbPath = join(dataDir, 'deepmine-dash.db');
console.log(`[db] Opening database at: ${dbPath} (DEEPMINE_DATA_DIR=${process.env.DEEPMINE_DATA_DIR || 'not set'})`);
const db = new Database(dbPath);

// Performance pragmas
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

// ── Schema ──────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    github_url TEXT NOT NULL DEFAULT '',
    institution TEXT NOT NULL DEFAULT '',
    total_runs INTEGER NOT NULL DEFAULT 0,
    total_bgcs INTEGER NOT NULL DEFAULT 0,
    total_novel INTEGER NOT NULL DEFAULT 0,
    best_score REAL NOT NULL DEFAULT 0,
    is_seed INTEGER NOT NULL DEFAULT 0,
    first_seen TEXT NOT NULL DEFAULT (datetime('now')),
    last_active TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    run_id TEXT UNIQUE NOT NULL,
    samples_processed INTEGER NOT NULL DEFAULT 0,
    bgcs_found INTEGER NOT NULL DEFAULT 0,
    novel_count INTEGER NOT NULL DEFAULT 0,
    top_score REAL NOT NULL DEFAULT 0,
    config_summary TEXT NOT NULL DEFAULT '',
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT NOT NULL DEFAULT (datetime('now')),
    duration_seconds INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS discoveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_db_id INTEGER NOT NULL REFERENCES runs(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    bgc_id TEXT NOT NULL,
    source_sample TEXT NOT NULL DEFAULT '',
    bgc_type TEXT NOT NULL DEFAULT '',
    predicted_product TEXT NOT NULL DEFAULT '',
    novelty_distance REAL NOT NULL DEFAULT 0,
    activity_score REAL NOT NULL DEFAULT 0,
    confidence REAL NOT NULL DEFAULT 0,
    bgc_length_bp INTEGER NOT NULL DEFAULT 0,
    gene_count INTEGER NOT NULL DEFAULT 0,
    detector_tools TEXT NOT NULL DEFAULT '[]',
    discovered_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sample_metadata (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sra_accession TEXT UNIQUE NOT NULL,
    environment_type TEXT NOT NULL DEFAULT '',
    location_name TEXT NOT NULL DEFAULT '',
    latitude REAL,
    longitude REAL,
    collection_date TEXT NOT NULL DEFAULT '',
    organism TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS global_processed (
    accession TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    bgcs_found INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'completed',
    processed_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS user_settings (
    username TEXT PRIMARY KEY,
    speed TEXT NOT NULL DEFAULT 'medium',
    mode TEXT NOT NULL DEFAULT 'always',
    bandwidth TEXT NOT NULL DEFAULT '5mb',
    schedule_start INTEGER NOT NULL DEFAULT 8,
    schedule_end INTEGER NOT NULL DEFAULT 22,
    download_start INTEGER NOT NULL DEFAULT 22,
    download_end INTEGER NOT NULL DEFAULT 6,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ── Indexes ─────────────────────────────────────────────────────────────────

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_users_total_bgcs ON users(total_bgcs DESC);
  CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
  CREATE INDEX IF NOT EXISTS idx_runs_user_id ON runs(user_id);
  CREATE INDEX IF NOT EXISTS idx_runs_run_id ON runs(run_id);
  CREATE INDEX IF NOT EXISTS idx_discoveries_run_db_id ON discoveries(run_db_id);
  CREATE INDEX IF NOT EXISTS idx_discoveries_user_id ON discoveries(user_id);
  CREATE INDEX IF NOT EXISTS idx_discoveries_bgc_type ON discoveries(bgc_type);
  CREATE INDEX IF NOT EXISTS idx_discoveries_activity_score ON discoveries(activity_score DESC);
  CREATE INDEX IF NOT EXISTS idx_discoveries_discovered_at ON discoveries(discovered_at);
  CREATE INDEX IF NOT EXISTS idx_sample_metadata_sra ON sample_metadata(sra_accession);
  CREATE INDEX IF NOT EXISTS idx_sample_metadata_env ON sample_metadata(environment_type);
`);

// ── Migrations ─────────────────────────────────────────────────────────────

try {
  db.exec(`ALTER TABLE users ADD COLUMN is_seed INTEGER NOT NULL DEFAULT 0`);
} catch { /* already exists */ }

try {
  db.exec(`ALTER TABLE users ADD COLUMN pin_hash TEXT NOT NULL DEFAULT ''`);
} catch { /* already exists */ }

try {
  db.exec(`ALTER TABLE discoveries ADD COLUMN sequence TEXT NOT NULL DEFAULT ''`);
} catch { /* already exists */ }

try {
  db.exec(`ALTER TABLE discoveries ADD COLUMN sequence_length INTEGER NOT NULL DEFAULT 0`);
} catch { /* already exists */ }

// ── Auth helpers ───────────────────────────────────────────────────────────

function hashPin(pin: string): string {
  const { createHash } = require('crypto');
  return createHash('sha256').update(pin).digest('hex');
}

export function registerUser(username: string, pin: string): { success: boolean; error?: string } {
  const existing = db.prepare(`SELECT id FROM users WHERE username = ?`).get(username);
  if (existing) {
    return { success: false, error: 'Username already taken.' };
  }
  db.prepare(
    `INSERT INTO users (username, display_name, pin_hash) VALUES (?, ?, ?)`
  ).run(username, username, hashPin(pin));
  return { success: true };
}

export function verifyUser(username: string, pin: string): { success: boolean; error?: string } {
  const user = db.prepare(`SELECT pin_hash FROM users WHERE username = ?`).get(username) as { pin_hash: string } | undefined;
  if (!user) {
    return { success: false, error: 'Username not found.' };
  }
  if (!user.pin_hash) {
    return { success: false, error: 'Account has no PIN set. Submit results first to create your account.' };
  }
  if (user.pin_hash !== hashPin(pin)) {
    return { success: false, error: 'Incorrect PIN.' };
  }
  return { success: true };
}

// ── Seed data helpers ──────────────────────────────────────────────────────

export function hasSeedData(): boolean {
  const row = db.prepare(`SELECT COUNT(*) AS cnt FROM users WHERE is_seed = 1`).get() as { cnt: number };
  return row.cnt > 0;
}

export function clearSeedData(): void {
  const clearTx = db.transaction(() => {
    // Delete discoveries linked to seed users
    db.exec(`DELETE FROM discoveries WHERE user_id IN (SELECT id FROM users WHERE is_seed = 1)`);
    // Delete runs linked to seed users
    db.exec(`DELETE FROM runs WHERE user_id IN (SELECT id FROM users WHERE is_seed = 1)`);
    // Delete seed users
    db.exec(`DELETE FROM users WHERE is_seed = 1`);
    // Clean up orphaned sample_metadata (samples not referenced by any remaining discovery)
    db.exec(`
      DELETE FROM sample_metadata
      WHERE sra_accession NOT IN (SELECT DISTINCT source_sample FROM discoveries)
    `);
  });
  clearTx();
}

export function clearAllData(): void {
  const clearTx = db.transaction(() => {
    db.exec(`DELETE FROM discoveries`);
    db.exec(`DELETE FROM runs`);
    db.exec(`DELETE FROM users`);
    db.exec(`DELETE FROM sample_metadata`);
    // Reset autoincrement counters
    db.exec(`DELETE FROM sqlite_sequence WHERE name IN ('discoveries', 'runs', 'users', 'sample_metadata')`);
  });
  clearTx();
}

// ── Prepared Statements ─────────────────────────────────────────────────────

const stmtGlobalStats = db.prepare(`
  SELECT
    COALESCE(SUM(u.total_bgcs), 0) AS total_bgcs,
    COALESCE(SUM(u.total_novel), 0) AS total_novel,
    COUNT(*) AS total_users,
    (SELECT COUNT(DISTINCT environment_type) FROM sample_metadata WHERE environment_type != '') AS total_environments,
    COALESCE((SELECT ROUND(AVG(activity_score), 4) FROM discoveries), 0) AS avg_score,
    COALESCE((SELECT MAX(activity_score) FROM discoveries), 0) AS top_score,
    COALESCE(SUM(u.total_runs), 0) AS total_runs
  FROM users u
`);

const stmtLeaderboard = db.prepare(`
  SELECT * FROM users ORDER BY total_bgcs DESC LIMIT ?
`);

const stmtTimeline = db.prepare(`
  SELECT
    date(discovered_at) AS date,
    COUNT(*) AS bgcs_found,
    SUM(CASE WHEN novelty_distance >= 0.5 THEN 1 ELSE 0 END) AS novel_found
  FROM discoveries
  WHERE discovered_at >= datetime('now', ? || ' days')
  GROUP BY date(discovered_at)
  ORDER BY date ASC
`);

const stmtDiscoveriesCount = db.prepare(`
  SELECT COUNT(*) AS total
  FROM discoveries d
  JOIN users u ON d.user_id = u.id
  WHERE d.activity_score >= ?
    AND (? = 'all' OR d.bgc_type = ?)
`);

const stmtDiscoveriesPage = db.prepare(`
  SELECT
    d.id, d.run_db_id, d.user_id, d.bgc_id, d.source_sample,
    d.bgc_type, d.predicted_product, d.novelty_distance,
    d.activity_score, d.confidence, d.bgc_length_bp, d.gene_count,
    d.detector_tools, d.sequence_length, d.discovered_at,
    u.username,
    u.display_name,
    u.institution
  FROM discoveries d
  JOIN users u ON d.user_id = u.id
  WHERE d.activity_score >= ?
    AND (? = 'all' OR d.bgc_type = ?)
  ORDER BY d.discovered_at DESC
  LIMIT ? OFFSET ?
`);

const stmtUserByUsername = db.prepare(`
  SELECT * FROM users WHERE username = ?
`);

const stmtUserRuns = db.prepare(`
  SELECT * FROM runs WHERE user_id = ? ORDER BY completed_at DESC
`);

const stmtUserDiscoveries = db.prepare(`
  SELECT * FROM discoveries WHERE user_id = ? ORDER BY discovered_at DESC
`);

// Insert/upsert statements
const stmtUpsertUser = db.prepare(`
  INSERT INTO users (username, display_name, github_url, institution, first_seen, last_active)
  VALUES (@username, @display_name, @github_url, @institution, datetime('now'), datetime('now'))
  ON CONFLICT(username) DO UPDATE SET
    display_name = CASE WHEN @display_name != '' THEN @display_name ELSE display_name END,
    github_url = CASE WHEN @github_url != '' THEN @github_url ELSE github_url END,
    institution = CASE WHEN @institution != '' THEN @institution ELSE institution END,
    last_active = datetime('now')
`);

const stmtGetUserId = db.prepare(`
  SELECT id FROM users WHERE username = ?
`);

const stmtInsertRun = db.prepare(`
  INSERT INTO runs (user_id, run_id, samples_processed, bgcs_found, novel_count, top_score, config_summary, started_at, completed_at, duration_seconds)
  VALUES (@user_id, @run_id, @samples_processed, @bgcs_found, @novel_count, @top_score, @config_summary, @started_at, @completed_at, @duration_seconds)
`);

const stmtInsertDiscovery = db.prepare(`
  INSERT INTO discoveries (run_db_id, user_id, bgc_id, source_sample, bgc_type, predicted_product, novelty_distance, activity_score, confidence, bgc_length_bp, gene_count, detector_tools, sequence, sequence_length, discovered_at)
  VALUES (@run_db_id, @user_id, @bgc_id, @source_sample, @bgc_type, @predicted_product, @novelty_distance, @activity_score, @confidence, @bgc_length_bp, @gene_count, @detector_tools, @sequence, @sequence_length, @discovered_at)
`);

const stmtUpsertSample = db.prepare(`
  INSERT INTO sample_metadata (sra_accession, environment_type, location_name, latitude, longitude)
  VALUES (@sra_accession, @environment_type, @location_name, @latitude, @longitude)
  ON CONFLICT(sra_accession) DO UPDATE SET
    environment_type = CASE WHEN @environment_type != '' THEN @environment_type ELSE environment_type END,
    location_name = CASE WHEN @location_name != '' THEN @location_name ELSE location_name END,
    latitude = COALESCE(@latitude, latitude),
    longitude = COALESCE(@longitude, longitude)
`);

const stmtUpdateUserStats = db.prepare(`
  UPDATE users SET
    total_runs = (SELECT COUNT(*) FROM runs WHERE user_id = ?),
    total_bgcs = (SELECT COUNT(*) FROM discoveries WHERE user_id = ?),
    total_novel = (SELECT COUNT(*) FROM discoveries WHERE user_id = ? AND novelty_distance >= 0.5),
    best_score = (SELECT COALESCE(MAX(activity_score), 0) FROM discoveries WHERE user_id = ?)
  WHERE id = ?
`);

// ── Query Helpers ───────────────────────────────────────────────────────────

export function getGlobalStats(): GlobalStats {
  const row = stmtGlobalStats.get() as Record<string, number>;
  return {
    total_bgcs: row.total_bgcs,
    total_novel: row.total_novel,
    total_users: row.total_users,
    total_environments: row.total_environments,
    avg_score: row.avg_score,
    top_score: row.top_score,
    total_runs: row.total_runs,
  };
}

export function getLeaderboard(limit = 10): User[] {
  return stmtLeaderboard.all(limit) as User[];
}

export function getTimeline(days = 90): TimelineEntry[] {
  const daysParam = `-${days}`;
  const rows = stmtTimeline.all(daysParam) as Array<{
    date: string;
    bgcs_found: number;
    novel_found: number;
  }>;

  let cumulativeBgcs = 0;
  let cumulativeNovel = 0;

  return rows.map((row) => {
    cumulativeBgcs += row.bgcs_found;
    cumulativeNovel += row.novel_found;
    return {
      date: row.date,
      bgcs_found: row.bgcs_found,
      novel_found: row.novel_found,
      cumulative_bgcs: cumulativeBgcs,
      cumulative_novel: cumulativeNovel,
    };
  });
}

export function getDiscoveries(
  page = 1,
  limit = 20,
  minScore = 0,
  bgcType = 'all'
): { discoveries: Discovery[]; total: number; page: number; pages: number } {
  const offset = (page - 1) * limit;

  const countRow = stmtDiscoveriesCount.get(minScore, bgcType, bgcType) as {
    total: number;
  };
  const total = countRow.total;
  const pages = Math.ceil(total / limit);

  const rows = stmtDiscoveriesPage.all(
    minScore,
    bgcType,
    bgcType,
    limit,
    offset
  ) as Array<Discovery & { username: string; display_name: string; institution: string }>;

  // Parse detector_tools JSON string back to array
  const discoveries = rows.map((row) => ({
    ...row,
    detector_tools:
      typeof row.detector_tools === 'string'
        ? JSON.parse(row.detector_tools)
        : row.detector_tools,
  }));

  return { discoveries, total, page, pages };
}

export function getUserProfile(username: string) {
  const user = stmtUserByUsername.get(username) as User | undefined;
  if (!user) return null;

  const runs = stmtUserRuns.all(user.id) as Run[];
  const discoveries = (stmtUserDiscoveries.all(user.id) as Array<Discovery & { detector_tools: string }>).map(
    (d) => ({
      ...d,
      detector_tools:
        typeof d.detector_tools === 'string'
          ? JSON.parse(d.detector_tools)
          : d.detector_tools,
    })
  );

  const stats = {
    total_runs: runs.length,
    total_bgcs: discoveries.length,
    total_novel: discoveries.filter((d) => d.novelty_distance >= 0.5).length,
    best_score: discoveries.reduce(
      (max, d) => Math.max(max, d.activity_score),
      0
    ),
    fully_novel: discoveries.filter((d) => d.novelty_distance >= 0.99).length,
    bgc_types: Object.entries(
      discoveries.reduce(
        (acc, d) => {
          acc[d.bgc_type] = (acc[d.bgc_type] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      )
    ).map(([type, count]) => ({ type, count })),
  };

  return { user, runs, discoveries, stats };
}

export const insertSubmission = db.transaction((payload: SubmitPayload) => {
  const {
    username,
    display_name = '',
    institution = '',
    github_url = '',
    run_id,
    config = '',
    samples,
    candidates,
  } = payload;

  // 1. Upsert user
  stmtUpsertUser.run({
    username,
    display_name,
    github_url,
    institution,
  });

  const userRow = stmtGetUserId.get(username) as { id: number };
  const userId = userRow.id;

  // 2. Insert samples metadata
  for (const sample of samples) {
    stmtUpsertSample.run({
      sra_accession: sample.sra_accession,
      environment_type: sample.environment || '',
      location_name: sample.location || '',
      latitude: sample.lat ?? null,
      longitude: sample.lon ?? null,
    });
  }

  // 3. Compute run-level aggregates from candidates
  const novelCount = candidates.filter((c) => c.novelty_distance >= 0.5).length;
  const topScore = candidates.reduce(
    (max, c) => Math.max(max, c.activity_score),
    0
  );

  const now = new Date().toISOString().replace('T', ' ').split('.')[0];

  const runResult = stmtInsertRun.run({
    user_id: userId,
    run_id,
    samples_processed: samples.length,
    bgcs_found: candidates.length,
    novel_count: novelCount,
    top_score: topScore,
    config_summary: config,
    started_at: now,
    completed_at: now,
    duration_seconds: 0,
  });

  const runDbId = runResult.lastInsertRowid as number;

  // 4. Insert discoveries
  for (const c of candidates) {
    stmtInsertDiscovery.run({
      run_db_id: runDbId,
      user_id: userId,
      bgc_id: c.bgc_id,
      source_sample: c.source_sample,
      bgc_type: c.bgc_type,
      predicted_product: c.predicted_product || '',
      novelty_distance: c.novelty_distance,
      activity_score: c.activity_score,
      confidence: c.confidence,
      bgc_length_bp: c.sequence_length || 0,
      gene_count: 0,
      detector_tools: '[]',
      sequence: c.sequence || '',
      sequence_length: c.sequence_length || 0,
      discovered_at: now,
    });
  }

  // 5. Refresh user aggregate stats
  stmtUpdateUserStats.run(userId, userId, userId, userId, userId);

  // 6. Record in global processed samples
  for (const sample of samples) {
    stmtRecordProcessed.run({
      accession: sample.sra_accession,
      username,
      bgcs_found: candidates.length,
    });
  }

  return { userId, runDbId, discoveriesCount: candidates.length };
});

// ── Global Processed Samples ──────────────────────────────────────────────

const stmtRecordProcessed = db.prepare(`
  INSERT INTO global_processed (accession, username, bgcs_found)
  VALUES (@accession, @username, @bgcs_found)
  ON CONFLICT(accession) DO UPDATE SET
    bgcs_found = MAX(global_processed.bgcs_found, excluded.bgcs_found),
    username = excluded.username,
    processed_at = datetime('now')
`);

const stmtCheckProcessed = db.prepare(`
  SELECT accession, username, bgcs_found, status FROM global_processed WHERE accession = ?
`);

const stmtGetProcessedList = db.prepare(`
  SELECT accession FROM global_processed
`);

export function isGloballyProcessed(accession: string): boolean {
  return !!stmtCheckProcessed.get(accession);
}

export function getProcessedAccessions(): string[] {
  return (stmtGetProcessedList.all() as { accession: string }[]).map(r => r.accession);
}

export function recordProcessed(accession: string, username: string, bgcs_found: number) {
  stmtRecordProcessed.run({ accession, username, bgcs_found });
}

// ── Public Export ──────────────────────────────────────────────────────────

export function getAllDiscoveriesWithSequences() {
  return db.prepare(`
    SELECT
      d.bgc_id, d.source_sample, d.bgc_type, d.predicted_product,
      d.novelty_distance, d.activity_score, d.confidence,
      d.sequence, d.sequence_length, d.discovered_at,
      u.username,
      sm.environment_type, sm.location_name
    FROM discoveries d
    JOIN users u ON u.id = d.user_id
    LEFT JOIN sample_metadata sm ON sm.sra_accession = d.source_sample
    WHERE u.is_seed = 0
    ORDER BY d.activity_score DESC
  `).all();
}

export function getDiscoveryStats() {
  return db.prepare(`
    SELECT
      COUNT(*) as total_discoveries,
      COUNT(CASE WHEN sequence != '' THEN 1 END) as with_sequences,
      COUNT(DISTINCT source_sample) as unique_samples,
      COUNT(DISTINCT user_id) as unique_contributors
    FROM discoveries d
    JOIN users u ON u.id = d.user_id
    WHERE u.is_seed = 0
  `).get();
}

// ── User Settings ─────────────────────────────────────────────────────────

export interface UserSettings {
  speed: string;
  mode: string;
  bandwidth: string;
  schedule_start: number;
  schedule_end: number;
  download_start: number;
  download_end: number;
}

const USER_SETTINGS_DEFAULTS: UserSettings = {
  speed: 'medium',
  mode: 'always',
  bandwidth: '5mb',
  schedule_start: 8,
  schedule_end: 22,
  download_start: 22,
  download_end: 6,
};

const stmtGetUserSettings = db.prepare(
  `SELECT speed, mode, bandwidth, schedule_start, schedule_end, download_start, download_end FROM user_settings WHERE username = ?`
);

const stmtUpsertUserSettings = db.prepare(`
  INSERT INTO user_settings (username, speed, mode, bandwidth, schedule_start, schedule_end, download_start, download_end, updated_at)
  VALUES (@username, @speed, @mode, @bandwidth, @schedule_start, @schedule_end, @download_start, @download_end, datetime('now'))
  ON CONFLICT(username) DO UPDATE SET
    speed = @speed,
    mode = @mode,
    bandwidth = @bandwidth,
    schedule_start = @schedule_start,
    schedule_end = @schedule_end,
    download_start = @download_start,
    download_end = @download_end,
    updated_at = datetime('now')
`);

export function getUserSettings(username: string): UserSettings {
  const row = stmtGetUserSettings.get(username) as UserSettings | undefined;
  return row || { ...USER_SETTINGS_DEFAULTS };
}

export function saveUserSettings(username: string, settings: UserSettings): void {
  stmtUpsertUserSettings.run({
    username,
    speed: settings.speed,
    mode: settings.mode,
    bandwidth: settings.bandwidth,
    schedule_start: settings.schedule_start,
    schedule_end: settings.schedule_end,
    download_start: settings.download_start,
    download_end: settings.download_end,
  });
}

// ── SSE Emitter ─────────────────────────────────────────────────────────────

type SSEClient = (event: string, data: string) => void;

class SSEEmitter {
  private clients: Set<SSEClient> = new Set();

  addClient(client: SSEClient) {
    this.clients.add(client);
  }

  removeClient(client: SSEClient) {
    this.clients.delete(client);
  }

  emit(event: string, data: unknown) {
    const payload = JSON.stringify(data);
    for (const client of this.clients) {
      try {
        client(event, payload);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  get clientCount() {
    return this.clients.size;
  }
}

// Singleton across hot-reloads
const globalForSSE = globalThis as unknown as { __sseEmitter?: SSEEmitter };
if (!globalForSSE.__sseEmitter) {
  globalForSSE.__sseEmitter = new SSEEmitter();
}

export const sseEmitter = globalForSSE.__sseEmitter;

export default db;
