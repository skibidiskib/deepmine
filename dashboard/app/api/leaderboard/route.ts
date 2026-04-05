import { NextRequest, NextResponse } from 'next/server';
import { getLeaderboard } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const limit = Math.min(
      Math.max(parseInt(searchParams.get('limit') || '10', 10) || 10, 1),
      100
    );

    const leaderboard = getLeaderboard(limit);

    return NextResponse.json(leaderboard);
  } catch (err) {
    console.error('[GET /api/leaderboard]', err);
    return NextResponse.json(
      { error: 'Failed to fetch leaderboard' },
      { status: 500 }
    );
  }
}
