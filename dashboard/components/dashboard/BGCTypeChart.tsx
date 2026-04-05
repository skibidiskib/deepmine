'use client';

import { useMemo } from 'react';
import useSWR from 'swr';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import GlassCard from '@/components/ui/GlassCard';
import { getBGCTypeColor } from '@/lib/utils';
import type { Discovery } from '@/lib/types';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const TYPE_COLORS: Record<string, string> = {
  NRPS: '#10b981',
  PKS: '#3b82f6',
  RiPP: '#f59e0b',
  terpene: '#8b5cf6',
  hybrid: '#ec4899',
  other: '#6b7280',
};

function GlassTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const entry = payload[0];

  return (
    <div className="rounded-xl p-3 bg-slate-900/90 backdrop-blur-md border border-white/15 shadow-xl">
      <p className="text-sm text-white font-medium">{entry.name}</p>
      <p className="text-xs text-gray-400">
        {entry.value.toLocaleString()} BGCs
      </p>
    </div>
  );
}

export default function BGCTypeChart() {
  const { data, isLoading } = useSWR<{ discoveries: Discovery[]; total: number }>(
    '/api/discoveries?limit=10000',
    fetcher,
    { refreshInterval: 60000 },
  );

  const chartData = useMemo(() => {
    const items = data?.discoveries;
    if (!items || !Array.isArray(items)) return [];

    const counts: Record<string, number> = {};
    for (const d of items) {
      const rawType = (d.bgc_type || 'other').toLowerCase();
      let type = 'other';
      if (rawType.includes('nrps')) type = 'NRPS';
      else if (rawType.includes('pks')) type = 'PKS';
      else if (rawType.includes('ripp') || rawType.includes('lanthipeptide') || rawType.includes('bacteriocin')) type = 'RiPP';
      else if (rawType.includes('terpene')) type = 'terpene';
      else if (rawType.includes('+') || rawType.includes('hybrid')) type = 'hybrid';
      counts[type] = (counts[type] || 0) + 1;
    }

    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [data]);

  return (
    <GlassCard hover={false}>
      <h2 className="text-lg font-semibold text-white mb-4">BGC Types</h2>

      {isLoading || !data ? (
        <div className="h-[300px] bg-white/5 rounded-lg animate-pulse" />
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="45%"
              innerRadius={60}
              outerRadius={100}
              paddingAngle={2}
              dataKey="value"
            >
              {chartData.map((entry) => (
                <Cell
                  key={entry.name}
                  fill={getBGCTypeColor(entry.name)}
                  stroke="transparent"
                />
              ))}
            </Pie>
            <Tooltip content={<GlassTooltip />} />
            <Legend
              verticalAlign="bottom"
              iconType="circle"
              formatter={(value: string) => (
                <span className="text-xs text-gray-300">{value}</span>
              )}
            />
          </PieChart>
        </ResponsiveContainer>
      )}
    </GlassCard>
  );
}
