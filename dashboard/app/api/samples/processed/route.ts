import { NextRequest, NextResponse } from 'next/server';
import { getProcessedAccessions, recordProcessed } from '@/lib/db';

export const dynamic = 'force-dynamic';

// SRA accession format: SRR/ERR/DRR followed by 6-12 digits
const ACCESSION_RE = /^[A-Z]{3}\d{6,12}$/;

/**
 * GET /api/samples/processed
 * Returns list of all globally processed accessions so containers
 * can skip samples already scanned by other volunteers.
 */
export async function GET() {
  try {
    const accessions = getProcessedAccessions();
    return NextResponse.json({ accessions, count: accessions.length });
  } catch (err) {
    console.error('[GET /api/samples/processed]', err);
    return NextResponse.json({ error: 'Failed to fetch processed samples' }, { status: 500 });
  }
}

/**
 * POST /api/samples/processed
 * Report a sample as processed (even with 0 BGCs).
 * Called by containers after each sample completes or is skipped.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.accession || !body.username) {
      return NextResponse.json(
        { error: 'Missing required fields: accession, username' },
        { status: 400 }
      );
    }

    // Validate accession format (SRR/ERR/DRR + 6-12 digits)
    if (!ACCESSION_RE.test(body.accession)) {
      return NextResponse.json(
        { error: 'Invalid accession format. Expected SRR/ERR/DRR followed by 6-12 digits.' },
        { status: 400 }
      );
    }

    recordProcessed(body.accession, body.username, body.bgcs_found ?? 0);

    return NextResponse.json({ success: true, accession: body.accession });
  } catch (err) {
    console.error('[POST /api/samples/processed]', err);
    return NextResponse.json({ error: 'Failed to record processed sample' }, { status: 500 });
  }
}
