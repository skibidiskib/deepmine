'use client';

import useSWR from 'swr';
import { Download, FileText, Database, Dna, FlaskConical } from 'lucide-react';
import Link from 'next/link';
import GlassCard from '@/components/ui/GlassCard';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function DiscoveriesPage() {
  const { data, isLoading } = useSWR('/api/export', fetcher);

  const stats = data?.stats;
  const discoveries = data?.discoveries || [];

  return (
    <div className="min-h-screen pb-12">
      <div className="max-w-[1400px] mx-auto px-3 sm:px-6 lg:px-8">
        <Link href="/" className="text-gray-400 hover:text-emerald-400 flex items-center gap-2 mb-6 text-sm transition-colors">
          &larr; Back to dashboard
        </Link>

        {/* Header */}
        <GlassCard className="mb-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-white flex items-center gap-3">
                <FlaskConical className="w-7 h-7 text-emerald-400" />
                Public BGC Discoveries
              </h1>
              <p className="text-gray-400 mt-1 text-sm">
                All biosynthetic gene clusters discovered by the DEEPMINE community. Free to download and use.
              </p>
            </div>
          </div>

          {/* Stats bar */}
          {stats && (
            <div className="flex flex-wrap gap-6 mt-4 pt-4 border-t border-white/10">
              <div className="text-center">
                <div className="text-xl font-bold text-white">{stats.total_discoveries || 0}</div>
                <div className="text-xs text-gray-500">Total BGCs</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-emerald-400">{stats.with_sequences || 0}</div>
                <div className="text-xs text-gray-500">With Sequences</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-blue-400">{stats.unique_samples || 0}</div>
                <div className="text-xs text-gray-500">Samples Screened</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-amber-400">{stats.unique_contributors || 0}</div>
                <div className="text-xs text-gray-500">Contributors</div>
              </div>
            </div>
          )}
        </GlassCard>

        {/* Download buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <a
            href="/api/export?format=fasta"
            className="flex items-center gap-3 px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 hover:bg-emerald-500/20 transition-colors"
          >
            <Dna className="w-5 h-5 text-emerald-400" />
            <div>
              <div className="text-sm font-medium text-white">Download FASTA</div>
              <div className="text-xs text-gray-500">Nucleotide sequences for all BGCs</div>
            </div>
            <Download className="w-4 h-4 text-emerald-400 ml-auto" />
          </a>
          <a
            href="/api/export?format=csv"
            className="flex items-center gap-3 px-4 py-3 rounded-xl bg-blue-500/10 border border-blue-500/30 hover:bg-blue-500/20 transition-colors"
          >
            <FileText className="w-5 h-5 text-blue-400" />
            <div>
              <div className="text-sm font-medium text-white">Download CSV</div>
              <div className="text-xs text-gray-500">Metadata spreadsheet (scores, types, sources)</div>
            </div>
            <Download className="w-4 h-4 text-blue-400 ml-auto" />
          </a>
          <a
            href="/api/export?format=json"
            className="flex items-center gap-3 px-4 py-3 rounded-xl bg-purple-500/10 border border-purple-500/30 hover:bg-purple-500/20 transition-colors"
          >
            <Database className="w-5 h-5 text-purple-400" />
            <div>
              <div className="text-sm font-medium text-white">JSON API</div>
              <div className="text-xs text-gray-500">Programmatic access for researchers</div>
            </div>
            <Download className="w-4 h-4 text-purple-400 ml-auto" />
          </a>
        </div>

        {/* Discoveries table */}
        <GlassCard>
          <h2 className="text-lg font-semibold text-white mb-4">
            Discovered BGCs {discoveries.length > 0 && `(${discoveries.length})`}
          </h2>

          {isLoading ? (
            <div className="text-gray-500 text-center py-8 animate-pulse">Loading discoveries...</div>
          ) : discoveries.length === 0 ? (
            <div className="text-center py-12">
              <FlaskConical className="w-10 h-10 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-400">No BGC discoveries with sequences yet</p>
              <p className="text-xs text-gray-600 mt-1">
                Volunteers are scanning metagenomes right now. Discoveries will appear here as they are found.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 border-b border-white/10">
                    <th className="text-left py-3 px-2">BGC ID</th>
                    <th className="text-left py-3 px-2">Type</th>
                    <th className="text-left py-3 px-2">Sample</th>
                    <th className="text-left py-3 px-2">Environment</th>
                    <th className="text-right py-3 px-2">Score</th>
                    <th className="text-right py-3 px-2">Novelty</th>
                    <th className="text-right py-3 px-2">Length</th>
                    <th className="text-left py-3 px-2">Found by</th>
                    <th className="text-left py-3 px-2">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {discoveries.map((d: any, i: number) => (
                    <tr key={i} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="py-3 px-2 font-mono text-xs text-gray-300">{d.bgc_id}</td>
                      <td className="py-3 px-2">
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-white/10">{d.bgc_type}</span>
                      </td>
                      <td className="py-3 px-2 font-mono text-xs text-gray-400">{d.source_sample}</td>
                      <td className="py-3 px-2 text-xs text-gray-400">{d.environment_type || '-'}</td>
                      <td className={`py-3 px-2 text-right font-mono ${
                        d.activity_score >= 0.8 ? 'text-emerald-400' :
                        d.activity_score >= 0.5 ? 'text-amber-400' : 'text-gray-500'
                      }`}>{d.activity_score?.toFixed(2)}</td>
                      <td className="py-3 px-2 text-right font-mono text-amber-400">{d.novelty_distance?.toFixed(2)}</td>
                      <td className="py-3 px-2 text-right font-mono text-gray-400">
                        {d.sequence_length > 0 ? `${(d.sequence_length / 1000).toFixed(1)}kb` : '-'}
                      </td>
                      <td className="py-3 px-2">
                        <Link href={`/user/${d.username}`} className="text-emerald-400 hover:text-emerald-300 text-xs">
                          {d.username}
                        </Link>
                      </td>
                      <td className="py-3 px-2 text-xs text-gray-500">
                        {d.discovered_at ? new Date(d.discovered_at + 'Z').toLocaleDateString() : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
