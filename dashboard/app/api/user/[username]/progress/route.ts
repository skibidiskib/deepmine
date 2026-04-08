import { NextRequest, NextResponse } from 'next/server';
import { getProgress, updateProgress, PIPELINE_STEPS } from '@/lib/progress';
import type { ProgressUpdate } from '@/lib/progress';

export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  try {
    const { username } = await params;

    if (!username) {
      return NextResponse.json(
        { error: 'Username is required' },
        { status: 400 }
      );
    }

    const progress = getProgress(username);

    if (!progress) {
      return NextResponse.json({ username, active: false });
    }

    // Consider progress stale if no heartbeat in 90 seconds
    const lastUpdate = new Date(progress.updated_at).getTime();
    const age = Date.now() - lastUpdate;
    const active = age < 90_000;

    return NextResponse.json({ ...progress, active });
  } catch (err) {
    console.error('[GET /api/user/[username]/progress]', err);
    return NextResponse.json(
      { error: 'Failed to fetch progress' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  try {
    const { username } = await params;
    const body = await request.json();

    // Validate required fields
    if (!body.step || !body.status || !body.sample) {
      return NextResponse.json(
        { error: 'Missing required fields: step, status, sample' },
        { status: 400 }
      );
    }

    // Validate step is known
    const validSteps = PIPELINE_STEPS.map((s) => s.key);
    if (!validSteps.includes(body.step)) {
      return NextResponse.json(
        { error: `Unknown step: ${body.step}. Valid steps: ${validSteps.join(', ')}` },
        { status: 400 }
      );
    }

    if (!['running', 'done', 'skipped'].includes(body.status)) {
      return NextResponse.json(
        { error: 'status must be "running", "done", or "skipped"' },
        { status: 400 }
      );
    }

    const update: ProgressUpdate = {
      username: body.username || username,
      sample: body.sample,
      environment: body.environment || 'unknown',
      description: body.description || '',
      step: body.step,
      status: body.status,
      duration: body.duration ?? null,
      session_completed: body.session_completed ?? 0,
      session_skipped: body.session_skipped ?? 0,
      sample_size_mb: body.sample_size_mb,
      sample_bases: body.sample_bases,
      downloaded_mb: body.downloaded_mb,
    };

    const progress = updateProgress(update);

    return NextResponse.json({ success: true, progress });
  } catch (err) {
    console.error('[POST /api/user/[username]/progress]', err);
    return NextResponse.json(
      { error: 'Failed to update progress' },
      { status: 500 }
    );
  }
}
