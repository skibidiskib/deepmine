import { NextRequest, NextResponse } from 'next/server';
import { getUserSettings, saveUserSettings } from '@/lib/db';

export const dynamic = 'force-dynamic';

const DEFAULTS = {
  speed: 'medium',
  mode: 'always',
  bandwidth: '5mb',
  timezone: 'UTC',
  schedule_start: 8,
  schedule_end: 22,
  download_start: 22,
  download_end: 6,
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const { username } = await params;
  const settings = getUserSettings(username);
  return NextResponse.json(settings);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  try {
    const { username } = await params;
    const body = await request.json();

    const validSpeeds = ['low', 'medium', 'high', 'maximum'];
    const validModes = ['always', 'scheduled', 'queue'];
    const validBandwidths = ['512kb', '1mb', '2mb', '5mb', '10mb', 'unlimited'];

    const speed = validSpeeds.includes(body.speed) ? body.speed : 'medium';
    const mode = validModes.includes(body.mode) ? body.mode : 'always';
    const bandwidth = validBandwidths.includes(body.bandwidth) ? body.bandwidth : 'unlimited';

    const clampHour = (v: unknown, fallback: number) => {
      const n = typeof v === 'number' ? v : parseInt(String(v), 10);
      return isNaN(n) ? fallback : Math.max(0, Math.min(23, n));
    };

    const schedule_start = clampHour(body.schedule_start, DEFAULTS.schedule_start);
    const schedule_end = clampHour(body.schedule_end, DEFAULTS.schedule_end);
    const download_start = clampHour(body.download_start, DEFAULTS.download_start);
    const download_end = clampHour(body.download_end, DEFAULTS.download_end);

    const timezone = typeof body.timezone === 'string' && body.timezone.length <= 50 ? body.timezone : 'UTC';
    const settings = { speed, mode, bandwidth, timezone, schedule_start, schedule_end, download_start, download_end };
    saveUserSettings(username, settings);

    return NextResponse.json({ success: true, ...settings });
  } catch (err) {
    console.error('[POST /api/user/[username]/settings]', err);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
