import { NextRequest, NextResponse } from 'next/server';
import { getAllDiscoveriesWithSequences, getDiscoveryStats } from '@/lib/db';

export const dynamic = 'force-dynamic';

function sanitize(v: string): string {
  return String(v || '').replace(/[\n\r|>"<=+@\-]/g, '_').slice(0, 200);
}

/**
 * GET /api/export?format=fasta|csv|json
 *
 * Public endpoint: download all BGC discoveries with sequences.
 * - fasta: Multi-FASTA file with BGC sequences + metadata in headers
 * - csv: Spreadsheet-ready CSV with all metadata
 * - json: Raw JSON array (default)
 */
export async function GET(request: NextRequest) {
  try {
    const format = request.nextUrl.searchParams.get('format') || 'json';
    const discoveries = getAllDiscoveriesWithSequences() as any[];

    if (format === 'fasta') {
      const lines: string[] = [];
      for (const d of discoveries) {
        if (!d.sequence) continue;
        // FASTA header: >bgc_id|sample|type|score|environment|contributor
        const header = [
          sanitize(d.bgc_id),
          sanitize(d.source_sample),
          sanitize(d.bgc_type),
          `score=${d.activity_score}`,
          `novelty=${d.novelty_distance}`,
          sanitize(d.environment_type || 'unknown'),
          `by=${sanitize(d.username)}`,
          d.discovered_at,
        ].join('|');
        lines.push(`>${header}`);
        // Wrap sequence at 80 chars
        const seq = d.sequence;
        for (let i = 0; i < seq.length; i += 80) {
          lines.push(seq.slice(i, i + 80));
        }
      }

      return new NextResponse(lines.join('\n') + '\n', {
        headers: {
          'Content-Type': 'text/plain',
          'Content-Disposition': `attachment; filename="deepmine-bgcs-${new Date().toISOString().split('T')[0]}.fasta"`,
        },
      });
    }

    if (format === 'csv') {
      const header = 'bgc_id,source_sample,bgc_type,activity_score,novelty_distance,confidence,sequence_length,environment,location,contributor,discovered_at';
      const rows = discoveries.map((d: any) =>
        [
          sanitize(d.bgc_id),
          sanitize(d.source_sample),
          sanitize(d.bgc_type),
          d.activity_score,
          d.novelty_distance,
          d.confidence,
          d.sequence_length,
          `"${sanitize(d.environment_type || '')}"`,
          `"${sanitize(d.location_name || '')}"`,
          sanitize(d.username),
          d.discovered_at,
        ].join(',')
      );

      return new NextResponse([header, ...rows].join('\n') + '\n', {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="deepmine-bgcs-${new Date().toISOString().split('T')[0]}.csv"`,
        },
      });
    }

    // Default: JSON
    const stats = getDiscoveryStats();
    return NextResponse.json({
      stats,
      discoveries: discoveries.map(({ sequence, ...rest }) => ({
        ...rest,
        sequence_preview: sequence ? sequence.slice(0, 100) + '...' : '',
      })),
      download_urls: {
        fasta: '/api/export?format=fasta',
        csv: '/api/export?format=csv',
      },
    });
  } catch (err) {
    console.error('[GET /api/export]', err);
    return NextResponse.json({ error: 'Failed to export data' }, { status: 500 });
  }
}
