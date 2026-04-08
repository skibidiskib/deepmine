import { NextResponse } from 'next/server';
import { getGlobalStats } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const stats = getGlobalStats();

    return NextResponse.json(stats, {
      headers: { 'Cache-Control': 'no-cache' },
    });
  } catch (err) {
    console.error('[GET /api/stats]', err);
    return NextResponse.json(
      { error: 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}
