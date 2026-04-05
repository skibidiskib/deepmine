'use client';

import useSWR from 'swr';
import { Dna, Sparkles, Users, Globe } from 'lucide-react';
import StatCard from '@/components/ui/StatCard';
import type { GlobalStats } from '@/lib/types';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function SkeletonCard() {
  return (
    <div className="rounded-2xl p-6 bg-gradient-to-br from-white/5 to-white/10 backdrop-blur-md border border-white/15 shadow-xl animate-pulse">
      <div className="h-4 w-24 bg-white/10 rounded mb-3" />
      <div className="h-8 w-32 bg-white/10 rounded mb-2" />
      <div className="h-3 w-16 bg-white/10 rounded" />
    </div>
  );
}

export default function HeroStats() {
  const { data, isLoading } = useSWR<GlobalStats>('/api/stats', fetcher, {
    refreshInterval: 30000,
  });

  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard
        title="Total BGCs"
        value={data.total_bgcs}
        icon={Dna}
        color="border-emerald-500"
        delta={`+${data.total_runs} runs`}
        index={0}
      />
      <StatCard
        title="Novel Candidates"
        value={data.total_novel}
        icon={Sparkles}
        color="border-amber-500"
        delta={`Top score: ${data.top_score.toFixed(2)}`}
        index={1}
      />
      <StatCard
        title="Contributors"
        value={data.total_users}
        icon={Users}
        color="border-blue-500"
        delta={`Avg ${Math.round(data.total_bgcs / Math.max(data.total_users, 1))} BGCs each`}
        index={2}
      />
      <StatCard
        title="Environments"
        value={data.total_environments}
        icon={Globe}
        color="border-purple-500"
        delta={`Avg score: ${data.avg_score.toFixed(2)}`}
        index={3}
      />
    </div>
  );
}
