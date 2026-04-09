/**
 * Auto-push BGC discoveries to GitHub repository.
 *
 * When new BGC sequences are submitted, this module writes FASTA files
 * and updates the CSV, then pushes to skibidiskib/deepmine-discoveries.
 */

import { execSync, spawnSync } from 'child_process';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

/** Sanitize a string for use as a filename: keep only safe characters. */
function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
}

function sanitizeField(value: string): string {
  return value.replace(/[\n\r|>"<]/g, '_').slice(0, 200);
}

const REPO_DIR = '/home/ubuntu/deepmine-discoveries';
const SEQUENCES_DIR = join(REPO_DIR, 'sequences');
const DATA_DIR = join(REPO_DIR, 'data');

interface BGCEntry {
  bgc_id: string;
  source_sample: string;
  bgc_type: string;
  activity_score: number;
  novelty_distance: number;
  confidence: number;
  sequence: string;
  sequence_length: number;
  environment: string;
  username: string;
  discovered_at: string;
}

/**
 * Write BGC sequences to the repo and push to GitHub.
 * Called after a successful submission with sequences.
 */
export function pushDiscoveriesToGitHub(entries: BGCEntry[]): boolean {
  const withSequences = entries.filter((e) => e.sequence && e.sequence.length > 0);
  if (withSequences.length === 0) return false;

  try {
    // Ensure directories exist
    mkdirSync(SEQUENCES_DIR, { recursive: true });
    mkdirSync(DATA_DIR, { recursive: true });

    const today = new Date().toISOString().split('T')[0];

    // Write individual FASTA files
    for (const entry of withSequences) {
      const filename = `${today}_${sanitizeFilename(entry.bgc_id)}.fasta`;
      const header = [
        sanitizeField(entry.bgc_id),
        sanitizeField(entry.source_sample),
        sanitizeField(entry.bgc_type),
        `score=${entry.activity_score}`,
        `novelty=${entry.novelty_distance}`,
        sanitizeField(entry.environment || 'unknown'),
        `by=${sanitizeField(entry.username)}`,
      ].join('|');

      let fasta = `>${header}\n`;
      for (let i = 0; i < entry.sequence.length; i += 80) {
        fasta += entry.sequence.slice(i, i + 80) + '\n';
      }

      writeFileSync(join(SEQUENCES_DIR, filename), fasta);
    }

    // Append to CSV
    const csvPath = join(DATA_DIR, 'all_discoveries.csv');
    const csvHeader = 'bgc_id,source_sample,bgc_type,activity_score,novelty_distance,confidence,sequence_length,environment,contributor,discovered_at';

    let csvContent = '';
    if (!existsSync(csvPath)) {
      csvContent = csvHeader + '\n';
    }

    for (const entry of withSequences) {
      csvContent += [
        sanitizeField(entry.bgc_id),
        sanitizeField(entry.source_sample),
        sanitizeField(entry.bgc_type),
        entry.activity_score,
        entry.novelty_distance,
        entry.confidence,
        entry.sequence_length,
        `"${sanitizeField(entry.environment || '')}"`,
        sanitizeField(entry.username),
        entry.discovered_at,
      ].join(',') + '\n';
    }

    writeFileSync(csvPath, csvContent, { flag: 'a' });

    // Update combined FASTA
    const allFastaPath = join(DATA_DIR, 'all_discoveries.fasta');
    let allFasta = '';
    for (const entry of withSequences) {
      const header = `>${sanitizeField(entry.bgc_id)}|${sanitizeField(entry.source_sample)}|${sanitizeField(entry.bgc_type)}|score=${entry.activity_score}|${sanitizeField(entry.environment || '')}|by=${sanitizeField(entry.username)}`;
      allFasta += header + '\n';
      for (let i = 0; i < entry.sequence.length; i += 80) {
        allFasta += entry.sequence.slice(i, i + 80) + '\n';
      }
    }
    writeFileSync(allFastaPath, allFasta, { flag: 'a' });

    // Git add, commit, push
    const gitOpts = { cwd: REPO_DIR, timeout: 30000 };
    spawnSync('git', ['add', '-A'], gitOpts);

    const commitMsg = `Add ${withSequences.length} BGC${withSequences.length > 1 ? 's' : ''} from ${sanitizeField(withSequences[0].source_sample)} (${sanitizeField(withSequences[0].environment || 'unknown')})`;
    const commit = spawnSync('git', ['commit', '-m', commitMsg], gitOpts);
    if (commit.status !== 0) {
      console.log('[github] No new changes to commit');
      return false;
    }
    const push = spawnSync('git', ['push', 'origin', 'main'], gitOpts);
    if (push.status !== 0) {
      console.error('[github] Push failed:', push.stderr?.toString());
      return false;
    }
    console.log(`[github] Pushed ${withSequences.length} discoveries to GitHub`);
    return true;
  } catch (err) {
    console.error('[github] Failed to push discoveries:', err);
    return false;
  }
}
