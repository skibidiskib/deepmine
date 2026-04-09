import { NextRequest, NextResponse } from 'next/server';
import { insertSubmission, sseEmitter, hasSeedData, clearSeedData } from '@/lib/db';
import { checkRateLimit } from '@/lib/rate-limit';
import { pushDiscoveriesToGitHub } from '@/lib/github-push';
import { scoreBatch } from '@/lib/novelty-scorer';
import type { SubmitPayload } from '@/lib/types';

export const dynamic = 'force-dynamic';

const USERNAME_RE = /^[a-zA-Z0-9_.\-]{1,40}$/;
const MAX_CANDIDATES = 1000;
const MAX_SEQUENCE_LENGTH = 200_000; // 200kb
const MAX_SAMPLES = 10;

function isScoreValid(v: unknown): boolean {
  return typeof v === 'number' && v >= 0 && v <= 1;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as SubmitPayload;

    // Basic validation
    if (!body.username || !body.run_id || !body.candidates || !body.samples) {
      return NextResponse.json(
        { error: 'Missing required fields: username, run_id, candidates, samples' },
        { status: 400 }
      );
    }

    // Username format validation
    if (!USERNAME_RE.test(body.username)) {
      return NextResponse.json(
        { error: 'username must be 1-40 alphanumeric characters, hyphens, or underscores' },
        { status: 400 }
      );
    }

    // Rate limiting
    if (!checkRateLimit(body.username)) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Try again in a minute.' },
        { status: 429 }
      );
    }

    if (!Array.isArray(body.candidates)) {
      return NextResponse.json(
        { error: 'candidates must be an array' },
        { status: 400 }
      );
    }

    if (body.candidates.length > MAX_CANDIDATES) {
      return NextResponse.json(
        { error: `candidates array exceeds maximum of ${MAX_CANDIDATES}` },
        { status: 400 }
      );
    }

    if (!Array.isArray(body.samples) || body.samples.length === 0) {
      return NextResponse.json(
        { error: 'samples must be a non-empty array' },
        { status: 400 }
      );
    }

    // Cap samples array size
    if (body.samples.length > MAX_SAMPLES) {
      body.samples = body.samples.slice(0, MAX_SAMPLES);
    }

    // Normalize candidate scores - default missing values to 0, clamp to [0,1]
    // Truncate oversized sequences
    for (const c of body.candidates) {
      c.activity_score = Math.max(0, Math.min(1, Number(c.activity_score) || 0));
      c.confidence = Math.max(0, Math.min(1, Number(c.confidence) || 0));
      if (c.sequence && c.sequence.length > MAX_SEQUENCE_LENGTH) {
        c.sequence = c.sequence.slice(0, MAX_SEQUENCE_LENGTH);
      }
    }

    // Server-side novelty scoring: BLAST against MIBiG 2,502 known BGCs
    const noveltyScores = scoreBatch(body.candidates);
    for (const c of body.candidates) {
      const score = noveltyScores.get(c.bgc_id);
      if (score) {
        c.novelty_distance = score.novelty_distance;
      } else {
        c.novelty_distance = Math.max(0, Math.min(1, Number(c.novelty_distance) || 0));
      }
    }

    // Auto-clear seed/demo data when the first real submission arrives
    let seedCleared = false;
    if (hasSeedData()) {
      clearSeedData();
      seedCleared = true;
      console.log('[POST /api/submit] Seed data cleared on first real submission');
    }

    const result = insertSubmission(body);

    // Emit SSE events
    sseEmitter.emit('new_run', {
      username: body.username,
      run_id: body.run_id,
      bgcs_found: result.discoveriesCount,
      timestamp: new Date().toISOString(),
    });

    // Emit individual events for high-scoring discoveries
    for (const candidate of body.candidates) {
      if (candidate.activity_score > 0.7) {
        sseEmitter.emit('new_discovery', {
          username: body.username,
          bgc_id: candidate.bgc_id,
          bgc_type: candidate.bgc_type,
          activity_score: candidate.activity_score,
          novelty_distance: candidate.novelty_distance,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Auto-push BGC sequences to GitHub (non-blocking)
    const bgcEntries = body.candidates
      .filter((c) => c.sequence && c.sequence.length > 0)
      .map((c) => ({
        bgc_id: c.bgc_id,
        source_sample: body.samples?.[0]?.sra_accession || '',
        bgc_type: c.bgc_type,
        activity_score: c.activity_score,
        novelty_distance: c.novelty_distance || 0,
        confidence: c.confidence,
        sequence: c.sequence || '',
        sequence_length: c.sequence_length || 0,
        environment: body.samples?.[0]?.environment || '',
        username: body.username,
        discovered_at: new Date().toISOString(),
      }));

    if (bgcEntries.length > 0) {
      try {
        pushDiscoveriesToGitHub(bgcEntries);
      } catch { /* non-critical */ }
    }

    return NextResponse.json({
      success: true,
      run_id: body.run_id,
      discoveries_count: result.discoveriesCount,
      seed_cleared: seedCleared,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';

    // Duplicate run_id
    if (message.includes('UNIQUE constraint failed')) {
      return NextResponse.json(
        { error: 'Duplicate run_id. This run has already been submitted.' },
        { status: 409 }
      );
    }

    console.error('[POST /api/submit]', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
