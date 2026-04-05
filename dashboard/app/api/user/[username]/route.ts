import { NextRequest, NextResponse } from 'next/server';
import { getUserProfile } from '@/lib/db';

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
      return NextResponse.json(
        { error: `User '${username}' not found` },
        { status: 404 }
      );
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
