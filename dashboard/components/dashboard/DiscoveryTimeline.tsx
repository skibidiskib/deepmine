'use client';

import useSWR from 'swr';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import GlassCard from '@/components/ui/GlassCard';
import { cn } from '@/lib/utils';
import type { TimelineEntry } from '@/lib/types';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function GlassTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-xl p-3 bg-slate-900/90 backdrop-blur-md border border-white/15 shadow-xl">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      {payload.map((entry: any) => (
        <p key={entry.name} className="text-sm" style={{ color: entry.color }}>
          {entry.name}: {entry.value.toLocaleString()}
        </p>
      ))}
    </div>
  );
}

export default function DiscoveryTimeline({ className }: { className?: string }) {
  const { data, isLoading } = useSWR<TimelineEntry[]>(
    '/api/timeline',
    fetcher,
    { refreshInterval: 60000 },
  );

  return (
    <GlassCard hover={false} className={className}>
      <h2 className="text-lg font-semibold text-white mb-4">
        Discovery Timeline
      </h2>

      {isLoading || !data ? (
        <div className="aspect-[2/1] bg-white/5 rounded-lg animate-pulse" />
      ) : (
          <ResponsiveContainer width="100%" aspect={2}>
            <AreaChart data={data}>
              <defs>
                <linearGradient id="gradBgc" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradNovel" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis
                dataKey="date"
                stroke="#6b7280"
                tick={{ fill: '#9ca3af', fontSize: 12 }}
              />
              <YAxis
                stroke="#6b7280"
                tick={{ fill: '#9ca3af', fontSize: 12 }}
              />
              <Tooltip content={<GlassTooltip />} />
              <Area
                type="monotone"
                dataKey="cumulative_bgcs"
                name="Total BGCs"
                stroke="#10b981"
                fill="url(#gradBgc)"
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="cumulative_novel"
                name="Novel"
                stroke="#f59e0b"
                fill="url(#gradNovel)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
      )}
    </GlassCard>
  );
}
