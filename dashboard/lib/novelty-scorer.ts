/**
 * Server-side BGC novelty scoring via BLAST against MIBiG database.
 *
 * When a BGC with a sequence is submitted, this module:
 * 1. Writes the sequence to a temp FASTA file
 * 2. BLASTs it against the MIBiG 3.1 database (2,502 known BGCs)
 * 3. Computes novelty_distance = 1 - (best_hit_identity / 100)
 * 4. Updates the discovery record in the DB
 *
 * A novelty_distance of 1.0 = completely novel (no similarity to any known BGC)
 * A novelty_distance of 0.0 = identical to a known BGC
 */

import { execSync } from 'child_process';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

const MIBIG_DB = '/home/ubuntu/mibig/mibig_db';
const TMP_DIR = '/tmp';

interface BlastResult {
  novelty_distance: number;
  best_hit_id: string;
  best_hit_identity: number;
  best_hit_coverage: number;
  best_hit_evalue: number;
}

/**
 * Score a BGC sequence's novelty by BLASTing against MIBiG.
 */
export function scoreNovelty(sequence: string): BlastResult | null {
  if (!sequence || sequence.length < 100) return null;
  if (!existsSync(MIBIG_DB + '.nsq')) return null;

  const tmpId = randomBytes(8).toString('hex');
  const queryFile = join(TMP_DIR, `deepmine_blast_${tmpId}.fasta`);

  try {
    // Write query FASTA
    writeFileSync(queryFile, `>query\n${sequence}\n`);

    // Run BLAST: output format 6 = tabular
    // Fields: qseqid sseqid pident length qcovs evalue bitscore
    const result = execSync(
      `blastn -query ${queryFile} -db ${MIBIG_DB} -outfmt "6 qseqid sseqid pident length qcovs evalue bitscore" -max_target_seqs 5 -evalue 1e-5 -num_threads 2 2>/dev/null`,
      { timeout: 60000, encoding: 'utf-8' }
    ).trim();

    if (!result) {
      // No hits = completely novel
      return {
        novelty_distance: 1.0,
        best_hit_id: 'none',
        best_hit_identity: 0,
        best_hit_coverage: 0,
        best_hit_evalue: 999,
      };
    }

    // Parse best hit (first line)
    const fields = result.split('\n')[0].split('\t');
    const sseqid = fields[1] || 'unknown';
    const pident = parseFloat(fields[2]) || 0;    // percent identity
    const qcovs = parseFloat(fields[4]) || 0;     // query coverage
    const evalue = parseFloat(fields[5]) || 999;

    // Novelty combines identity and coverage:
    // A 95% identity over 80% coverage = 0.76 similarity = 0.24 novelty
    const similarity = (pident / 100) * (qcovs / 100);
    const novelty_distance = Math.round((1 - similarity) * 10000) / 10000;

    return {
      novelty_distance: Math.max(0, Math.min(1, novelty_distance)),
      best_hit_id: sseqid,
      best_hit_identity: pident,
      best_hit_coverage: qcovs,
      best_hit_evalue: evalue,
    };
  } catch (err) {
    console.error('[novelty-scorer] BLAST failed:', err);
    return null;
  } finally {
    try { unlinkSync(queryFile); } catch { /* ignore */ }
  }
}

/**
 * Score multiple BGCs and return updated records.
 */
export function scoreBatch(
  candidates: Array<{ bgc_id: string; sequence?: string }>
): Map<string, BlastResult> {
  const results = new Map<string, BlastResult>();

  for (const c of candidates) {
    if (!c.sequence || c.sequence.length < 100) continue;

    const result = scoreNovelty(c.sequence);
    if (result) {
      results.set(c.bgc_id, result);
      console.log(
        `[novelty] ${c.bgc_id}: distance=${result.novelty_distance} best_hit=${result.best_hit_id} identity=${result.best_hit_identity}%`
      );
    }
  }

  return results;
}
