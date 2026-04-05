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

// Ensure data directory exists
const dataDir = join(process.cwd(), 'data');
mkdirSync(dataDir, { recursive: true });

const db = new Database(join(dataDir, 'deepmine-dash.db'));

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

// ── Prepared Statements ─────────────────────────────────────────────────────

const stmtGlobalStats = db.prepare(`
  SELECT
    COALESCE(SUM(u.total_bgcs), 0) AS total_bgcs,
    COALESCE(SUM(u.total_novel), 0) AS total_novel,
    COUNT(*) AS total_users,
    (SELECT COUNT(DISTINCT environment_type) FROM sample_metadata WHERE environment_type != '') AS total_environments,
    COALESCE(ROUND(AVG(d.activity_score), 4), 0) AS avg_score,
    COALESCE(MAX(d.activity_score), 0) AS top_score,
    COALESCE(SUM(u.total_runs), 0) AS total_runs
  FROM users u
  LEFT JOIN discoveries d ON d.user_id = u.id
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
    d.*,
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
  INSERT INTO discoveries (run_db_id, user_id, bgc_id, source_sample, bgc_type, predicted_product, novelty_distance, activity_score, confidence, bgc_length_bp, gene_count, detector_tools, discovered_at)
  VALUES (@run_db_id, @user_id, @bgc_id, @source_sample, @bgc_type, @predicted_product, @novelty_distance, @activity_score, @confidence, @bgc_length_bp, @gene_count, @detector_tools, @discovered_at)
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
      bgc_length_bp: 0,
      gene_count: 0,
      detector_tools: '[]',
      discovered_at: now,
    });
  }

  // 5. Refresh user aggregate stats
  stmtUpdateUserStats.run(userId, userId, userId, userId, userId);

  return { userId, runDbId, discoveriesCount: candidates.length };
});

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
