import { NextResponse } from 'next/server';
import { scoreNovelty } from '@/lib/novelty-scorer';
import Database from 'better-sqlite3';
import { join } from 'path';

export const dynamic = 'force-dynamic';

const dataDir = process.env.DEEPMINE_DATA_DIR || join(process.cwd(), 'data');

/**
 * POST /api/admin/rescore
 * Re-score all existing discoveries that have sequences but novelty_distance = 0.
 */
export async function POST() {
  try {
    const db = new Database(join(dataDir, 'deepmine-dash.db'));

    const discoveries = db.prepare(`
      SELECT id, bgc_id, sequence, novelty_distance
      FROM discoveries
      WHERE sequence != '' AND (novelty_distance = 0 OR novelty_distance IS NULL)
    `).all() as Array<{ id: number; bgc_id: string; sequence: string; novelty_distance: number }>;

    let scored = 0;
    for (const d of discoveries) {
      const result = scoreNovelty(d.sequence);
      if (result) {
        db.prepare('UPDATE discoveries SET novelty_distance = ? WHERE id = ?')
          .run(result.novelty_distance, d.id);
        scored++;
        console.log(`[rescore] ${d.bgc_id}: novelty=${result.novelty_distance} hit=${result.best_hit_id}`);
      }
    }

    db.close();
    return NextResponse.json({ success: true, total: discoveries.length, scored });
  } catch (err) {
    console.error('[POST /api/admin/rescore]', err);
    return NextResponse.json({ error: 'Rescore failed' }, { status: 500 });
  }
}
