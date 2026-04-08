'use client';

import { use, useEffect } from 'react';
import useSWR from 'swr';
import { Dna, Sparkles, BarChart3, Trophy, ArrowLeft, ExternalLink, Calendar, Search, Layers, Activity, Clock } from 'lucide-react';
import Link from 'next/link';
import GlassCard from '@/components/ui/GlassCard';
import StatCard from '@/components/ui/StatCard';
import StatusBadge from '@/components/ui/StatusBadge';
import PipelineProgress from '@/components/dashboard/PipelineProgress';
import SamplesScanned from '@/components/dashboard/SamplesScanned';
import MiningSettingsInline from '@/components/dashboard/MiningSettingsInline';
import { formatDate, formatNumber } from '@/lib/utils';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function UserPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = use(params);
  const { data, error, isLoading } = useSWR(`/api/user/${username}`, fetcher, { refreshInterval: 10000 });

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [username]);

  if (isLoading) {
    return (
      <div className="min-h-screen pt-20 pb-12 flex items-center justify-center">
        <div className="text-gray-400 animate-pulse">Loading user profile...</div>
      </div>
    );
  }

  // API returns { user, runs, discoveries } for existing users
  // or { username, total_runs, ... } for placeholder profiles
  const user = data?.user || data;
  const runs = data?.runs || [];
  const discoveries = data?.discoveries || [];
  const stats = data?.stats;

  if (error || !data || data.error || !user?.username) {
    return (
      <div className="min-h-screen pt-20 pb-12 flex flex-col items-center justify-center gap-4">
        <div className="text-gray-400">User not found</div>
        <Link href="/" className="text-emerald-400 hover:text-emerald-300 flex items-center gap-2">
          <ArrowLeft className="w-4 h-4" /> Back to dashboard
        </Link>
      </div>
    );
  }

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
                {user.first_seen && (
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> Joined {new Date(user.first_seen + 'Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                )}
              </div>
            </div>
            <MiningSettingsInline username={user.username} />
          </div>
        </GlassCard>

        {/* User Stats - show live progress metrics when lifetime stats are zero */}
        {(user.total_bgcs > 0 || user.total_runs > 0) ? (
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <StatCard title="Total BGCs" value={user.total_bgcs} icon={Dna} color="border-emerald-500" />
            <StatCard title="Novel Candidates" value={user.total_novel} icon={Sparkles} color="border-amber-500" />
            <StatCard title="Pipeline Runs" value={user.total_runs} icon={BarChart3} color="border-blue-500" />
            <StatCard title="Fully Novel" value={stats?.fully_novel ?? 0} icon={Trophy} color="border-purple-500" />
          </section>
        ) : (
          <LiveStatCards username={user.username} joinedAt={user.first_seen} />
        )}

        {/* Pipeline Progress + Samples Scanned (side by side) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
          <PipelineProgress username={user.username} />
          <SamplesScanned username={user.username} />
        </div>

        {/* Runs Table - only show when there's data */}
        {runs.length > 0 && (
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
                  {runs.map((run: any) => (
                    <tr key={run.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="py-3 px-2 text-emerald-400 font-mono text-xs">{run.run_id}</td>
                      <td className="py-3 px-2 text-gray-400">{formatDate(run.completed_at)}</td>
                      <td className="py-3 px-2 text-right">{run.samples_processed}</td>
                      <td className="py-3 px-2 text-right">{run.bgcs_found}</td>
                      <td className="py-3 px-2 text-right text-amber-400">{run.novel_count}</td>
                      <td className="py-3 px-2 text-right"><StatusBadge score={run.top_score} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </GlassCard>
        )}

        {/* Discoveries Table - only show when there's data */}
        {discoveries.length > 0 && (
          <GlassCard>
            <h2 className="text-lg font-semibold text-white mb-4">Discoveries ({discoveries.length})</h2>
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
                  {discoveries.slice(0, 50).map((d: any) => (
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
                </tbody>
              </table>
            </div>
          </GlassCard>
        )}
      </div>
    </div>
  );
}

function LiveStatCards({ username, joinedAt }: { username: string; joinedAt?: string }) {
  const { data } = useSWR(`/api/user/${username}/progress`, fetcher, { refreshInterval: 5000 });

  const isActive = data?.active === true;
  const steps = data?.steps || [];
  const completedSteps = steps.filter((s: { status: string }) => s.status === 'done').length;
  const totalSteps = steps.length || 6;
  const samplesScanned = (data?.session_completed || 0) + (data?.session_skipped || 0) + (isActive ? 1 : 0);

  // Calculate mining time
  let miningMinutes = 0;
  if (joinedAt) {
    const joined = new Date(joinedAt + 'Z');
    miningMinutes = Math.max(0, Math.floor((Date.now() - joined.getTime()) / 60000));
  }
  const miningTime = miningMinutes < 60
    ? `${miningMinutes}m`
    : `${Math.floor(miningMinutes / 60)}h ${miningMinutes % 60}m`;

  return (
    <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      <StatCard
        title="Samples Scanned"
        value={samplesScanned}
        icon={Search}
        color="border-emerald-500"
        delta={isActive ? '+Scanning now' : 'Starting soon'}
      />
      <StatCard
        title="Current Step"
        value={completedSteps}
        icon={Layers}
        color="border-amber-500"
        suffix={`/${totalSteps}`}
        delta={isActive ? steps.find((s: { status: string }) => s.status === 'running')?.name || '' : 'Pending'}
      />
      <StatCard
        title="Environments"
        value={isActive ? 1 : 0}
        icon={Activity}
        color="border-blue-500"
        delta={data?.environment ? data.environment : 'Pending'}
      />
      <StatCard
        title="Time Contributing"
        value={miningMinutes < 60 ? miningMinutes : Math.floor(miningMinutes / 60)}
        icon={Clock}
        color="border-purple-500"
        suffix={miningMinutes < 60 ? ' min' : miningMinutes < 120 ? ' hr' : ' hrs'}
        delta={isActive ? '+Active now' : 'Since you joined'}
      />
    </section>
  );
}
