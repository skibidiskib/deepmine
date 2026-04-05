import { NextRequest, NextResponse } from 'next/server';
import { getTimeline } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const days = Math.min(
      Math.max(parseInt(searchParams.get('days') || '90', 10) || 90, 1),
      365
    );

    const timeline = getTimeline(days);

    return NextResponse.json(timeline);
  } catch (err) {
    console.error('[GET /api/timeline]', err);
    return NextResponse.json(
      { error: 'Failed to fetch timeline' },
      { status: 500 }
    );
  }
}
