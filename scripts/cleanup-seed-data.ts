/**
 * cleanup-seed-data.ts
 *
 * Removes all demo/seed users and their associated runs, discoveries,
 * sample_metadata, and global_processed entries from the DEEPMINE dashboard
 * SQLite database. Keeps only real users (e.g. "azure.lagoon") and their data.
 *
 * USAGE (local, if you have a copy of the DB):
 *   DEEPMINE_DATA_DIR=/path/to/data npx tsx scripts/cleanup-seed-data.ts
 *
 * USAGE (on server .147 via SSH):
 *   ssh ubuntu@<server-ip> 'cd /home/ubuntu/deepmine-dashboard && \
 *     DEEPMINE_DATA_DIR=/home/ubuntu/deepmine-data npx tsx scripts/cleanup-seed-data.ts'
 *
 * Or copy this script to the server first:
 *   scp scripts/cleanup-seed-data.ts ubuntu@<server-ip>:/home/ubuntu/deepmine-dashboard/scripts/
 *   ssh ubuntu@<server-ip> 'cd /home/ubuntu/deepmine-dashboard && \
 *     DEEPMINE_DATA_DIR=/home/ubuntu/deepmine-data npx tsx scripts/cleanup-seed-data.ts'
 *
 * DRY RUN (default): Shows what would be deleted without making changes.
 *   Pass --execute to actually delete.
 *
 *   DEEPMINE_DATA_DIR=/home/ubuntu/deepmine-data npx tsx scripts/cleanup-seed-data.ts --execute
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync } from 'fs';

// ── Config ──────────────────────────────────────────────────────────────────

const DATA_DIR = process.env.DEEPMINE_DATA_DIR || join(process.cwd(), 'data');
const DB_PATH = join(DATA_DIR, 'deepmine-dash.db');
const DRY_RUN = !process.argv.includes('--execute');

// The 10 seed usernames from the seed route
const SEED_USERNAMES = [
  'bright.cave',
  'silent.reef',
  'deep.spore',
  'swift.ridge',
  'bold.delta',
  'calm.grove',
  'vast.field',
  'keen.shore',
  'polar.fern',
  'amber.creek',
];

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  console.log('=== DEEPMINE Seed Data Cleanup ===\n');
  console.log(`Database: ${DB_PATH}`);
  console.log(`Mode:     ${DRY_RUN ? 'DRY RUN (pass --execute to apply)' : 'EXECUTE (changes will be applied!)'}\n`);

  if (!existsSync(DB_PATH)) {
    console.error(`ERROR: Database not found at ${DB_PATH}`);
    console.error('Set DEEPMINE_DATA_DIR to the directory containing deepmine-dash.db');
    process.exit(1);
  }

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // ── 1. Survey all users ─────────────────────────────────────────────────

  const allUsers = db.prepare('SELECT id, username, is_seed, total_runs, total_bgcs, total_novel, first_seen, last_active FROM users ORDER BY id').all() as Array<{
    id: number;
    username: string;
    is_seed: number;
    total_runs: number;
    total_bgcs: number;
    total_novel: number;
    first_seen: string;
    last_active: string;
  }>;

  console.log(`Found ${allUsers.length} total users:\n`);
  console.log('  ID  | Username         | is_seed | Runs | BGCs | Novel | First Seen          | Last Active');
  console.log('  ' + '-'.repeat(95));

  for (const u of allUsers) {
    const marker = SEED_USERNAMES.includes(u.username) || u.is_seed === 1 ? ' [SEED]' : ' [KEEP]';
    console.log(
      `  ${String(u.id).padStart(3)} | ${u.username.padEnd(16)} | ${String(u.is_seed).padStart(7)} | ${String(u.total_runs).padStart(4)} | ${String(u.total_bgcs).padStart(4)} | ${String(u.total_novel).padStart(5)} | ${u.first_seen} | ${u.last_active}${marker}`
    );
  }
  console.log();

  // ── 2. Identify seed users to delete ─────────────────────────────────────
  // Two strategies: (a) is_seed = 1 flag, (b) username in the known seed list
  // We use both to be thorough.

  const seedUsers = allUsers.filter(
    (u) => u.is_seed === 1 || SEED_USERNAMES.includes(u.username)
  );

  const keepUsers = allUsers.filter(
    (u) => u.is_seed !== 1 && !SEED_USERNAMES.includes(u.username)
  );

  if (seedUsers.length === 0) {
    console.log('No seed users found. Database is already clean.');
    db.close();
    return;
  }

  console.log(`Will DELETE ${seedUsers.length} seed user(s): ${seedUsers.map((u) => u.username).join(', ')}`);
  console.log(`Will KEEP ${keepUsers.length} real user(s): ${keepUsers.map((u) => u.username).join(', ')}\n`);

  const seedUserIds = seedUsers.map((u) => u.id);
  const idPlaceholders = seedUserIds.map(() => '?').join(', ');

  // ── 3. Count affected rows ───────────────────────────────────────────────

  const discoveriesCount = (db.prepare(
    `SELECT COUNT(*) AS cnt FROM discoveries WHERE user_id IN (${idPlaceholders})`
  ).get(...seedUserIds) as { cnt: number }).cnt;

  const runsCount = (db.prepare(
    `SELECT COUNT(*) AS cnt FROM runs WHERE user_id IN (${idPlaceholders})`
  ).get(...seedUserIds) as { cnt: number }).cnt;

  // Sample accessions only referenced by seed users (orphaned after cleanup)
  const orphanedSamples = db.prepare(`
    SELECT COUNT(*) AS cnt FROM sample_metadata
    WHERE sra_accession NOT IN (
      SELECT DISTINCT source_sample FROM discoveries
      WHERE user_id NOT IN (${idPlaceholders})
    )
  `).get(...seedUserIds) as { cnt: number };

  // global_processed entries from seed usernames
  const seedUsernameList = seedUsers.map((u) => u.username);
  const usernamesPlaceholders = seedUsernameList.map(() => '?').join(', ');

  const globalProcessedCount = (db.prepare(
    `SELECT COUNT(*) AS cnt FROM global_processed WHERE username IN (${usernamesPlaceholders})`
  ).get(...seedUsernameList) as { cnt: number }).cnt;

  console.log('Rows to delete:');
  console.log(`  discoveries:      ${discoveriesCount}`);
  console.log(`  runs:             ${runsCount}`);
  console.log(`  users:            ${seedUsers.length}`);
  console.log(`  sample_metadata:  ${orphanedSamples.cnt} (orphaned, not referenced by remaining discoveries)`);
  console.log(`  global_processed: ${globalProcessedCount} (entries submitted by seed usernames)`);
  console.log();

  // ── 4. Execute or skip ───────────────────────────────────────────────────

  if (DRY_RUN) {
    console.log('DRY RUN complete. No changes made.');
    console.log('Run with --execute to apply the cleanup.\n');
    db.close();
    return;
  }

  console.log('Executing cleanup in a transaction...');

  const cleanup = db.transaction(() => {
    // Order matters: delete children before parents (foreign key constraints)

    // 4a. Delete discoveries for seed users
    const delDiscoveries = db.prepare(
      `DELETE FROM discoveries WHERE user_id IN (${idPlaceholders})`
    ).run(...seedUserIds);
    console.log(`  Deleted ${delDiscoveries.changes} discoveries`);

    // 4b. Delete runs for seed users
    const delRuns = db.prepare(
      `DELETE FROM runs WHERE user_id IN (${idPlaceholders})`
    ).run(...seedUserIds);
    console.log(`  Deleted ${delRuns.changes} runs`);

    // 4c. Delete global_processed entries from seed usernames
    const delGlobal = db.prepare(
      `DELETE FROM global_processed WHERE username IN (${usernamesPlaceholders})`
    ).run(...seedUsernameList);
    console.log(`  Deleted ${delGlobal.changes} global_processed entries`);

    // 4d. Delete seed users
    const delUsers = db.prepare(
      `DELETE FROM users WHERE id IN (${idPlaceholders})`
    ).run(...seedUserIds);
    console.log(`  Deleted ${delUsers.changes} users`);

    // 4e. Clean up orphaned sample_metadata
    // (samples not referenced by any remaining discovery)
    const delSamples = db.prepare(`
      DELETE FROM sample_metadata
      WHERE sra_accession NOT IN (SELECT DISTINCT source_sample FROM discoveries)
    `).run();
    console.log(`  Deleted ${delSamples.changes} orphaned sample_metadata entries`);

    // 4f. Recalculate stats for remaining users
    const remainingUsers = db.prepare('SELECT id FROM users').all() as Array<{ id: number }>;
    const updateStats = db.prepare(`
      UPDATE users SET
        total_runs = (SELECT COUNT(*) FROM runs WHERE user_id = ?),
        total_bgcs = (SELECT COUNT(*) FROM discoveries WHERE user_id = ?),
        total_novel = (SELECT COUNT(*) FROM discoveries WHERE user_id = ? AND novelty_distance >= 0.5),
        best_score = (SELECT COALESCE(MAX(activity_score), 0) FROM discoveries WHERE user_id = ?)
      WHERE id = ?
    `);
    for (const u of remainingUsers) {
      updateStats.run(u.id, u.id, u.id, u.id, u.id);
    }
    console.log(`  Recalculated stats for ${remainingUsers.length} remaining user(s)`);
  });

  cleanup();

  // ── 5. Verify ────────────────────────────────────────────────────────────

  console.log('\n=== Post-Cleanup Verification ===\n');

  const finalUsers = db.prepare('SELECT id, username, total_runs, total_bgcs, total_novel FROM users ORDER BY id').all() as Array<{
    id: number;
    username: string;
    total_runs: number;
    total_bgcs: number;
    total_novel: number;
  }>;

  if (finalUsers.length === 0) {
    console.log('WARNING: No users remain in the database!');
  } else {
    console.log(`${finalUsers.length} user(s) remain:`);
    for (const u of finalUsers) {
      console.log(`  ${u.username}: ${u.total_runs} runs, ${u.total_bgcs} BGCs, ${u.total_novel} novel`);
    }
  }

  const finalDiscoveries = (db.prepare('SELECT COUNT(*) AS cnt FROM discoveries').get() as { cnt: number }).cnt;
  const finalRuns = (db.prepare('SELECT COUNT(*) AS cnt FROM runs').get() as { cnt: number }).cnt;
  const finalSamples = (db.prepare('SELECT COUNT(*) AS cnt FROM sample_metadata').get() as { cnt: number }).cnt;
  const finalGlobal = (db.prepare('SELECT COUNT(*) AS cnt FROM global_processed').get() as { cnt: number }).cnt;

  console.log(`\nRemaining rows: ${finalDiscoveries} discoveries, ${finalRuns} runs, ${finalSamples} samples, ${finalGlobal} global_processed`);
  console.log('\nCleanup complete.');

  db.close();
}

main();
