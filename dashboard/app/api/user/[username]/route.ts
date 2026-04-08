import { NextRequest, NextResponse } from 'next/server';
import { getUserProfile } from '@/lib/db';
import { getProgress } from '@/lib/progress';

export const dynamic = 'force-dynamic';

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

    const profile = getUserProfile(username);

    if (!profile) {
      // Return placeholder for users who haven't submitted yet.
      // Use progress data to derive first_seen if available.
      const progress = getProgress(username);
      return NextResponse.json({
        username,
        display_name: username,
        total_runs: 0,
        total_bgcs: 0,
        total_novel: 0,
        best_score: 0,
        first_seen: progress?.updated_at?.replace('T', ' ').split('.')[0] || null,
        runs: [],
        discoveries: [],
      });
    }

    return NextResponse.json(profile);
  } catch (err) {
    console.error('[GET /api/user/[username]]', err);
    return NextResponse.json(
      { error: 'Failed to fetch user profile' },
      { status: 500 }
    );
  }
}
