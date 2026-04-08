import { NextRequest, NextResponse } from 'next/server';
import { getDiscoveries } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;

    const page = Math.max(parseInt(searchParams.get('page') || '1', 10) || 1, 1);
    const limit = Math.min(
      Math.max(parseInt(searchParams.get('limit') || '20', 10) || 20, 1),
      100
    );
    const minScore = Math.max(
      parseFloat(searchParams.get('min_score') || '0') || 0,
      0
    );
    const type = searchParams.get('type') || 'all';

    const result = getDiscoveries(page, limit, minScore, type);

    return NextResponse.json(result);
  } catch (err) {
    console.error('[GET /api/discoveries]', err);
    return NextResponse.json(
      { error: 'Failed to fetch discoveries' },
      { status: 500 }
    );
  }
}
