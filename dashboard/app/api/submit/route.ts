import { NextRequest, NextResponse } from 'next/server';
import { insertSubmission, sseEmitter } from '@/lib/db';
import type { SubmitPayload } from '@/lib/types';

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

    if (!Array.isArray(body.candidates) || body.candidates.length === 0) {
      return NextResponse.json(
        { error: 'candidates must be a non-empty array' },
        { status: 400 }
      );
    }

    if (!Array.isArray(body.samples) || body.samples.length === 0) {
      return NextResponse.json(
        { error: 'samples must be a non-empty array' },
        { status: 400 }
      );
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

    return NextResponse.json({
      success: true,
      run_id: body.run_id,
      discoveries_count: result.discoveriesCount,
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
