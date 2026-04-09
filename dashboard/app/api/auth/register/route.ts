import { NextRequest, NextResponse } from 'next/server';
import { registerUser } from '@/lib/db';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// Reserved usernames used by seed data
const RESERVED = new Set([
  // Original seed usernames
  'bright.cave', 'silent.reef', 'deep.spore', 'swift.ridge',
  'bold.delta', 'calm.grove', 'vast.field', 'keen.shore',
  'polar.fern', 'amber.creek',
  // Community volunteers
  'bright.glacier', 'silent.reef', 'cosmic.tide', 'frozen.peak',
  'deep.current', 'amber.ridge', 'crystal.bay', 'iron.marsh',
  'swift.canyon', 'jade.lagoon', 'solar.drift', 'storm.hollow',
  'coral.mesa', 'ember.brook', 'arctic.sage', 'lunar.vale',
  'misty.cove', 'onyx.shore', 'wild.spring', 'echo.field',
  // System
  'anonymous', 'admin', 'system', 'deepmine',
]);

export async function POST(request: NextRequest) {
  try {
    // Rate limit by IP to prevent mass account creation
    const ip = request.headers.get('x-forwarded-for') || 'unknown';
    if (!checkRateLimit(`auth:register:${ip}`)) {
      return NextResponse.json(
        { success: false, error: 'Too many registration attempts. Try again in a minute.' },
        { status: 429 }
      );
    }

    const { username, pin } = await request.json();

    if (!username || !/^[a-zA-Z0-9_.]{1,30}$/.test(username)) {
      return NextResponse.json(
        { success: false, error: 'Invalid username.' },
        { status: 400 }
      );
    }

    if (RESERVED.has(username)) {
      return NextResponse.json(
        { success: false, error: 'Username already taken.' },
        { status: 409 }
      );
    }

    if (!pin || !/^\d{6}$/.test(pin)) {
      return NextResponse.json(
        { success: false, error: 'PIN must be exactly 6 digits.' },
        { status: 400 }
      );
    }

    const result = registerUser(username, pin);

    if (!result.success) {
      return NextResponse.json(result, { status: 409 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[POST /api/auth/register]', err);
    return NextResponse.json(
      { success: false, error: 'Registration failed.' },
      { status: 500 }
    );
  }
}
