import { NextResponse } from 'next/server';
import db, { clearAllData } from '@/lib/db';

export const dynamic = 'force-dynamic';

// ── Realistic demo data generators ──────────────────────────────────────────

const USERS = [
  { username: 'bright.cave', display_name: 'bright.cave', institution: '', github_url: '' },
  { username: 'silent.reef', display_name: 'silent.reef', institution: '', github_url: '' },
  { username: 'deep.spore', display_name: 'deep.spore', institution: '', github_url: '' },
  { username: 'swift.ridge', display_name: 'swift.ridge', institution: '', github_url: '' },
  { username: 'bold.delta', display_name: 'bold.delta', institution: '', github_url: '' },
  { username: 'calm.grove', display_name: 'calm.grove', institution: '', github_url: '' },
  { username: 'vast.field', display_name: 'vast.field', institution: '', github_url: '' },
  { username: 'keen.shore', display_name: 'keen.shore', institution: '', github_url: '' },
  { username: 'polar.fern', display_name: 'polar.fern', institution: '', github_url: '' },
  { username: 'amber.creek', display_name: 'amber.creek', institution: '', github_url: '' },
];

const ENVIRONMENTS = [
  'cave', 'deep_sea', 'hot_spring', 'permafrost',
  'acid_mine', 'soil', 'ocean', 'mangrove',
];

const LOCATIONS: Record<string, { name: string; lat: number; lon: number }[]> = {
  cave: [
    { name: 'Lechuguilla Cave, NM', lat: 32.17, lon: -104.50 },
    { name: 'Movile Cave, Romania', lat: 43.83, lon: 28.56 },
  ],
  deep_sea: [
    { name: 'Mariana Trench', lat: 11.35, lon: 142.20 },
    { name: 'Mid-Atlantic Ridge', lat: 23.37, lon: -44.95 },
  ],
  hot_spring: [
    { name: 'Yellowstone NP, WY', lat: 44.46, lon: -110.83 },
    { name: 'Dallol, Ethiopia', lat: 14.24, lon: 40.30 },
  ],
  permafrost: [
    { name: 'Svalbard, Norway', lat: 78.23, lon: 15.63 },
    { name: 'Yakutsk, Siberia', lat: 62.03, lon: 129.73 },
  ],
  acid_mine: [
    { name: 'Rio Tinto, Spain', lat: 37.72, lon: -6.55 },
    { name: 'Iron Mountain, CA', lat: 40.68, lon: -122.53 },
  ],
  soil: [
    { name: 'Amazon Rainforest, Brazil', lat: -3.47, lon: -62.22 },
    { name: 'Borneo Lowland, Malaysia', lat: 1.55, lon: 110.35 },
  ],
  ocean: [
    { name: 'Sargasso Sea', lat: 28.50, lon: -66.00 },
    { name: 'Great Barrier Reef', lat: -18.29, lon: 147.70 },
  ],
  mangrove: [
    { name: 'Sundarbans, Bangladesh', lat: 21.95, lon: 89.18 },
    { name: 'Everglades, FL', lat: 25.29, lon: -80.90 },
  ],
};

const BGC_TYPES_WEIGHTED = [
  // 35% NRPS
  'NRPS', 'NRPS', 'NRPS', 'NRPS', 'NRPS', 'NRPS', 'NRPS',
  // 25% PKS variants
  'T1PKS', 'T1PKS', 'T2PKS', 'T3PKS', 'transAT-PKS',
  // 15% RiPP
  'lanthipeptide', 'thiopeptide', 'RiPP-like',
  // 10% terpene
  'terpene', 'terpene',
  // 10% hybrid
  'NRPS-PKS-hybrid', 'PKS-RiPP-hybrid',
  // 5% other
  'siderophore',
];

const PRODUCTS: Record<string, string[]> = {
  NRPS: ['vancomycin-like', 'daptomycin-like', 'tyrocidin-like', 'gramicidin-like', 'cyclosporin-like', 'bleomycin-like'],
  T1PKS: ['erythromycin-like', 'rapamycin-like', 'avermectin-like', 'epothilone-like'],
  T2PKS: ['tetracycline-like', 'doxorubicin-like', 'oxytetracycline-like'],
  T3PKS: ['flavonoid-like', 'stilbene-like', 'chalcone-like'],
  'transAT-PKS': ['pederin-like', 'bacillaene-like', 'mupirocin-like'],
  lanthipeptide: ['nisin-like', 'mersacidin-like', 'actagardine-like'],
  thiopeptide: ['thiostrepton-like', 'nosiheptide-like'],
  'RiPP-like': ['bottromycin-like', 'cyanobactin-like'],
  terpene: ['geosmin', 'albaflavenone', 'pentalenene', 'hopanoid'],
  'NRPS-PKS-hybrid': ['epothilone-like', 'bleomycin-like', 'yersiniabactin-like'],
  'PKS-RiPP-hybrid': ['hybrid-peptide-001', 'hybrid-peptide-002'],
  siderophore: ['enterobactin-like', 'desferrioxamine-like', 'pyoverdine-like'],
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Normal distribution via Box-Muller, clamped to [0, 1] */
function normalRandom(mean: number, std: number): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(0, Math.min(1, mean + z * std));
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDateInLastDays(days: number): string {
  const now = Date.now();
  const offset = Math.random() * days * 86_400_000;
  const d = new Date(now - offset);
  return d.toISOString().replace('T', ' ').split('.')[0];
}

function makeSRA(): string {
  const prefixes = ['SRR', 'ERR', 'DRR'];
  return pick(prefixes) + randomInt(10000000, 99999999).toString();
}

function makeBgcId(username: string, index: number): string {
  return `${username}_bgc_${String(index).padStart(4, '0')}`;
}

// ── Seed transaction ────────────────────────────────────────────────────────

export async function POST() {
  try {
    // Prepared statements for seed
    const insertUser = db.prepare(`
      INSERT OR IGNORE INTO users (username, display_name, github_url, institution, is_seed, first_seen, last_active)
      VALUES (@username, @display_name, @github_url, @institution, 1, @first_seen, @last_active)
    `);

    const getUserId = db.prepare(`SELECT id FROM users WHERE username = ?`);

    const insertRun = db.prepare(`
      INSERT INTO runs (user_id, run_id, samples_processed, bgcs_found, novel_count, top_score, config_summary, started_at, completed_at, duration_seconds)
      VALUES (@user_id, @run_id, @samples_processed, @bgcs_found, @novel_count, @top_score, @config_summary, @started_at, @completed_at, @duration_seconds)
    `);

    const insertDiscovery = db.prepare(`
      INSERT INTO discoveries (run_db_id, user_id, bgc_id, source_sample, bgc_type, predicted_product, novelty_distance, activity_score, confidence, bgc_length_bp, gene_count, detector_tools, discovered_at)
      VALUES (@run_db_id, @user_id, @bgc_id, @source_sample, @bgc_type, @predicted_product, @novelty_distance, @activity_score, @confidence, @bgc_length_bp, @gene_count, @detector_tools, @discovered_at)
    `);

    const insertSample = db.prepare(`
      INSERT OR IGNORE INTO sample_metadata (sra_accession, environment_type, location_name, latitude, longitude, collection_date, organism)
      VALUES (@sra_accession, @environment_type, @location_name, @latitude, @longitude, @collection_date, @organism)
    `);

    const updateUserStats = db.prepare(`
      UPDATE users SET
        total_runs = (SELECT COUNT(*) FROM runs WHERE user_id = ?),
        total_bgcs = (SELECT COUNT(*) FROM discoveries WHERE user_id = ?),
        total_novel = (SELECT COUNT(*) FROM discoveries WHERE user_id = ? AND novelty_distance >= 0.5),
        best_score = (SELECT COALESCE(MAX(activity_score), 0) FROM discoveries WHERE user_id = ?)
      WHERE id = ?
    `);

    let usersCreated = 0;
    let runsCreated = 0;
    let discoveriesCreated = 0;

    const seedAll = db.transaction(() => {
      let globalBgcIndex = 0;

      for (const userData of USERS) {
        const firstSeen = randomDateInLastDays(14);

        insertUser.run({
          ...userData,
          first_seen: firstSeen,
          last_active: randomDateInLastDays(3),
        });
        usersCreated++;

        const userRow = getUserId.get(userData.username) as { id: number };
        const userId = userRow.id;

        // 1-3 runs per user (new project, low activity)
        const numRuns = randomInt(1, 3);

        for (let r = 0; r < numRuns; r++) {
          const runStarted = randomDateInLastDays(14);
          const durationSec = randomInt(300, 3600);
          const runCompleted = new Date(
            new Date(runStarted.replace(' ', 'T') + 'Z').getTime() + durationSec * 1000
          )
            .toISOString()
            .replace('T', ' ')
            .split('.')[0];

          // 3-12 discoveries per run (realistic for early stage)
          const numDiscoveries = randomInt(3, 12);

          // Pick environment for this run
          const env = pick(ENVIRONMENTS);
          const loc = pick(LOCATIONS[env]);

          // Create samples for this run (3-8 samples)
          const numSamples = randomInt(3, 8);
          const sraAccessions: string[] = [];

          for (let s = 0; s < numSamples; s++) {
            const sra = makeSRA();
            sraAccessions.push(sra);

            const collDate = new Date(
              Date.now() - randomInt(30, 365) * 86_400_000
            )
              .toISOString()
              .split('T')[0];

            insertSample.run({
              sra_accession: sra,
              environment_type: env,
              location_name: loc.name,
              latitude: loc.lat + randomFloat(-0.1, 0.1),
              longitude: loc.lon + randomFloat(-0.1, 0.1),
              collection_date: collDate,
              organism: pick([
                'Streptomyces sp.', 'Bacillus subtilis', 'Pseudomonas fluorescens',
                'Micromonospora sp.', 'Amycolatopsis sp.', 'Actinoplanes sp.',
                'Salinispora arenicola', 'Nocardia sp.',
              ]),
            });
          }

          // Compute per-run aggregates after generating candidates
          let runTopScore = 0;
          let runNovelCount = 0;
          const candidates: Array<{
            bgc_type: string;
            novelty_distance: number;
            activity_score: number;
          }> = [];

          // Pre-generate candidate data to compute run aggregates
          for (let d = 0; d < numDiscoveries; d++) {
            const bgcType = pick(BGC_TYPES_WEIGHTED);
            const activityScore = Math.round(normalRandom(0.45, 0.2) * 10000) / 10000;
            const noveltyDist = Math.round(randomFloat(0.1, 1.0) * 10000) / 10000;

            candidates.push({ bgc_type: bgcType, novelty_distance: noveltyDist, activity_score: activityScore });

            if (activityScore > runTopScore) runTopScore = activityScore;
            if (noveltyDist >= 0.5) runNovelCount++;
          }

          const runId = `run_${userData.username}_${r}_${Date.now().toString(36)}`;

          const runResult = insertRun.run({
            user_id: userId,
            run_id: runId,
            samples_processed: numSamples,
            bgcs_found: numDiscoveries,
            novel_count: runNovelCount,
            top_score: runTopScore,
            config_summary: `antiSMASH ${pick(['7.1', '7.0', '6.1'])} / DeepBGC ${pick(['0.1.30', '0.1.29'])} / ${env} pipeline`,
            started_at: runStarted,
            completed_at: runCompleted,
            duration_seconds: durationSec,
          });
          runsCreated++;

          const runDbId = runResult.lastInsertRowid as number;

          // Insert discoveries
          for (let d = 0; d < numDiscoveries; d++) {
            const c = candidates[d];
            globalBgcIndex++;

            const bgcType = c.bgc_type;
            const productList = PRODUCTS[bgcType] || ['unknown-product'];
            const discoveredAt = randomDateInLastDays(85);

            insertDiscovery.run({
              run_db_id: runDbId,
              user_id: userId,
              bgc_id: makeBgcId(userData.username, globalBgcIndex),
              source_sample: pick(sraAccessions),
              bgc_type: bgcType,
              predicted_product: pick(productList),
              novelty_distance: c.novelty_distance,
              activity_score: c.activity_score,
              confidence: Math.round(randomFloat(0.5, 0.99) * 10000) / 10000,
              bgc_length_bp: randomInt(10000, 120000),
              gene_count: randomInt(5, 65),
              detector_tools: JSON.stringify(
                [
                  pick(['antiSMASH', 'DeepBGC', 'GECCO']),
                  ...(Math.random() > 0.5
                    ? [pick(['BiG-SCAPE', 'PRISM', 'ClusterFinder'])]
                    : []),
                ]
              ),
              discovered_at: discoveredAt,
            });
            discoveriesCreated++;
          }

          // Update user aggregate stats
          updateUserStats.run(userId, userId, userId, userId, userId);
        }
      }
    });

    seedAll();

    return NextResponse.json({
      success: true,
      users_created: usersCreated,
      runs_created: runsCreated,
      discoveries_created: discoveriesCreated,
    });
  } catch (err) {
    console.error('[POST /api/seed]', err);
    const message = err instanceof Error ? err.message : 'Seed failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    clearAllData();
    return NextResponse.json({ success: true, message: 'All data cleared' });
  } catch (err) {
    console.error('[DELETE /api/seed]', err);
    const message = err instanceof Error ? err.message : 'Clear failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
