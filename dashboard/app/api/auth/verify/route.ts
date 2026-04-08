import { NextRequest, NextResponse } from 'next/server';
import { verifyUser } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const { username, pin } = await request.json();

    if (!username || !pin) {
      return NextResponse.json(
        { success: false, error: 'Username and PIN are required.' },
        { status: 400 }
      );
    }

    const result = verifyUser(username, pin);

    if (!result.success) {
      return NextResponse.json(result, { status: 401 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[POST /api/auth/verify]', err);
    return NextResponse.json(
      { success: false, error: 'Verification failed.' },
      { status: 500 }
    );
  }
}
