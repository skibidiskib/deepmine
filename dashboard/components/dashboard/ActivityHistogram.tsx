'use client';

import { useMemo } from 'react';
import useSWR from 'swr';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  ResponsiveContainer,
} from 'recharts';
import GlassCard from '@/components/ui/GlassCard';
import type { Discovery } from '@/lib/types';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const BIN_LABELS = [
  '0.0',
  '0.1',
  '0.2',
  '0.3',
  '0.4',
  '0.5',
  '0.6',
  '0.7',
  '0.8',
  '0.9',
];

function getBarColor(binIndex: number): string {
  if (binIndex < 3) return '#ef4444'; // red
  if (binIndex < 5) return '#f59e0b'; // amber
  if (binIndex < 7) return '#eab308'; // yellow
  return '#10b981'; // emerald
}

function GlassTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-xl p-3 bg-slate-900/90 backdrop-blur-md border border-white/15 shadow-xl">
      <p className="text-xs text-gray-400 mb-1">Score: {label}</p>
      <p className="text-sm text-white">
        {payload[0].value.toLocaleString()} discoveries
      </p>
    </div>
  );
}

export default function ActivityHistogram() {
  const { data, isLoading } = useSWR<{ discoveries: Discovery[] }>(
    '/api/discoveries?limit=10000',
    fetcher,
    { refreshInterval: 60000 },
  );

  const chartData = useMemo(() => {
    const bins = Array.from({ length: 10 }, () => 0);
    const items = data?.discoveries;

    if (items && Array.isArray(items)) {
      for (const d of items) {
        const idx = Math.min(Math.floor(d.activity_score * 10), 9);
        bins[idx]++;
      }
    }

    return bins.map((count, i) => ({
      range: BIN_LABELS[i],
      count,
    }));
  }, [data]);

  return (
    <GlassCard hover={false}>
      <h2 className="text-lg font-semibold text-white mb-4">
        Activity Score Distribution
      </h2>

      {isLoading || !data ? (
        <div className="h-[300px] bg-white/5 rounded-lg animate-pulse" />
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(255,255,255,0.1)"
            />
            <XAxis
              dataKey="range"
              stroke="#6b7280"
              tick={{ fill: '#9ca3af', fontSize: 12 }}
            />
            <YAxis
              stroke="#6b7280"
              tick={{ fill: '#9ca3af', fontSize: 12 }}
            />
            <Tooltip content={<GlassTooltip />} />
            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
              {chartData.map((_, i) => (
                <Cell key={i} fill={getBarColor(i)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </GlassCard>
  );
}
