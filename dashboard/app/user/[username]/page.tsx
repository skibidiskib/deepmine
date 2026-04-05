'use client';

import { use } from 'react';
import useSWR from 'swr';
import { Dna, Sparkles, BarChart3, Trophy, ArrowLeft, ExternalLink, Calendar } from 'lucide-react';
import Link from 'next/link';
import GlassCard from '@/components/ui/GlassCard';
import StatCard from '@/components/ui/StatCard';
import StatusBadge from '@/components/ui/StatusBadge';
import { formatDate, formatNumber } from '@/lib/utils';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function UserPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = use(params);
  const { data, error, isLoading } = useSWR(`/api/user/${username}`, fetcher);

  if (isLoading) {
    return (
      <div className="min-h-screen pt-20 pb-12 flex items-center justify-center">
        <div className="text-gray-400 animate-pulse">Loading user profile...</div>
      </div>
    );
  }

  if (error || !data || !data.user) {
    return (
      <div className="min-h-screen pt-20 pb-12 flex flex-col items-center justify-center gap-4">
        <div className="text-gray-400">User not found</div>
        <Link href="/" className="text-emerald-400 hover:text-emerald-300 flex items-center gap-2">
          <ArrowLeft className="w-4 h-4" /> Back to dashboard
        </Link>
      </div>
    );
  }

  const { user, runs, discoveries } = data;

  return (
    <div className="min-h-screen pb-8 sm:pb-12">
      <div className="max-w-[1400px] mx-auto px-3 sm:px-6 lg:px-8">
        {/* Back link */}
        <Link href="/" className="text-gray-400 hover:text-emerald-400 flex items-center gap-2 mb-6 text-sm transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to dashboard
        </Link>

        {/* User Profile Header */}
        <GlassCard className="mb-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center text-2xl font-bold">
              {user.username.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-white">{user.display_name || user.username}</h1>
              <div className="flex flex-wrap items-center gap-3 mt-1 text-sm text-gray-400">
                {user.institution && <span>{user.institution}</span>}
                {user.github_url && (
                  <a href={user.github_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300">
                    <ExternalLink className="w-3 h-3" /> GitHub
                  </a>
                )}
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3" /> Joined {formatDate(user.first_seen)}
                </span>
              </div>
            </div>
          </div>
        </GlassCard>

        {/* User Stats */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard title="Total BGCs" value={user.total_bgcs} icon={Dna} color="border-emerald-500" />
          <StatCard title="Novel Candidates" value={user.total_novel} icon={Sparkles} color="border-amber-500" />
          <StatCard title="Pipeline Runs" value={user.total_runs} icon={BarChart3} color="border-blue-500" />
          <StatCard title="Best Score" value={user.best_score} icon={Trophy} color="border-purple-500" suffix="" />
        </section>

        {/* Runs Table */}
        <GlassCard className="mb-8">
          <h2 className="text-lg font-semibold text-white mb-4">Pipeline Runs</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 border-b border-white/10">
                  <th className="text-left py-3 px-2">Run ID</th>
                  <th className="text-left py-3 px-2">Date</th>
                  <th className="text-right py-3 px-2">Samples</th>
                  <th className="text-right py-3 px-2">BGCs</th>
                  <th className="text-right py-3 px-2">Novel</th>
                  <th className="text-right py-3 px-2">Top Score</th>
                </tr>
              </thead>
              <tbody>
                {runs?.map((run: any) => (
                  <tr key={run.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="py-3 px-2 text-emerald-400 font-mono text-xs">{run.run_id}</td>
                    <td className="py-3 px-2 text-gray-400">{formatDate(run.completed_at)}</td>
                    <td className="py-3 px-2 text-right">{run.samples_processed}</td>
                    <td className="py-3 px-2 text-right">{run.bgcs_found}</td>
                    <td className="py-3 px-2 text-right text-amber-400">{run.novel_count}</td>
                    <td className="py-3 px-2 text-right"><StatusBadge score={run.top_score} /></td>
                  </tr>
                ))}
                {(!runs || runs.length === 0) && (
                  <tr><td colSpan={6} className="py-8 text-center text-gray-500">No runs yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </GlassCard>

        {/* Discoveries Table */}
        <GlassCard>
          <h2 className="text-lg font-semibold text-white mb-4">Discoveries ({discoveries?.length || 0})</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 border-b border-white/10">
                  <th className="text-left py-3 px-2">BGC ID</th>
                  <th className="text-left py-3 px-2">Type</th>
                  <th className="text-left py-3 px-2">Sample</th>
                  <th className="text-right py-3 px-2">Novelty</th>
                  <th className="text-right py-3 px-2">Activity</th>
                  <th className="text-right py-3 px-2">Confidence</th>
                  <th className="text-left py-3 px-2">Date</th>
                </tr>
              </thead>
              <tbody>
                {discoveries?.slice(0, 50).map((d: any) => (
                  <tr key={d.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="py-3 px-2 font-mono text-xs text-gray-300">{d.bgc_id}</td>
                    <td className="py-3 px-2">
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-white/10">{d.bgc_type}</span>
                    </td>
                    <td className="py-3 px-2 text-gray-400 text-xs">{d.source_sample}</td>
                    <td className="py-3 px-2 text-right text-amber-400">{d.novelty_distance?.toFixed(2)}</td>
                    <td className="py-3 px-2 text-right"><StatusBadge score={d.activity_score} /></td>
                    <td className="py-3 px-2 text-right text-gray-400">{d.confidence?.toFixed(2)}</td>
                    <td className="py-3 px-2 text-gray-500 text-xs">{formatDate(d.discovered_at)}</td>
                  </tr>
                ))}
                {(!discoveries || discoveries.length === 0) && (
                  <tr><td colSpan={7} className="py-8 text-center text-gray-500">No discoveries yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
