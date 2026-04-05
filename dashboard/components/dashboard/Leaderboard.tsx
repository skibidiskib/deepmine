'use client';

import useSWR from 'swr';
import GlassCard from '@/components/ui/GlassCard';
import StatusBadge from '@/components/ui/StatusBadge';
import { cn } from '@/lib/utils';
import type { LeaderboardEntry } from '@/lib/types';


const fetcher = (url: string) => fetch(url).then((r) => r.json());

const RANK_COLORS: Record<number, string> = {
  1: 'text-yellow-400',
  2: 'text-gray-300',
  3: 'text-amber-600',
};

const RANK_BORDERS: Record<number, string> = {
  1: 'border-l-2 border-yellow-400/50',
  2: 'border-l-2 border-gray-300/50',
  3: 'border-l-2 border-amber-600/50',
};

export default function Leaderboard({ className }: { className?: string }) {
  const { data, isLoading } = useSWR<LeaderboardEntry[]>(
    '/api/leaderboard?limit=7',
    fetcher,
    { refreshInterval: 60000 },
  );

  return (
    <GlassCard hover={false} className={className}>
      <h2 className="text-lg font-semibold text-white mb-4">
        Top Contributors
      </h2>

      {isLoading || !data ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-12 bg-white/5 rounded-lg animate-pulse"
            />
          ))}
        </div>
      ) : (
        <div className="space-y-1">
          {data.map((user, i) => {
            const rank = i + 1;
            return (
              <div
                key={user.id}
                className={cn(
                  'flex items-center gap-4 px-3 py-2.5 rounded-lg hover:bg-white/5 transition-colors',
                  RANK_BORDERS[rank],
                )}
              >
                <span
                  className={cn(
                    'w-6 text-center text-sm font-bold',
                    RANK_COLORS[rank] ?? 'text-gray-500',
                  )}
                >
                  {rank}
                </span>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">
                    {user.display_name || user.username}
                  </p>
                  <p className="text-xs text-gray-500 truncate">
                    {user.institution}
                  </p>
                </div>

                <span className="text-sm text-gray-300 tabular-nums">
                  {user.total_bgcs.toLocaleString()} BGCs
                </span>

                <StatusBadge score={user.best_score} />
              </div>
            );
          })}
        </div>
      )}
    </GlassCard>
  );
}
