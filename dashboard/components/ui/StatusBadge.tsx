'use client';

import { cn } from '@/lib/utils';

interface StatusBadgeProps {
  score: number;
}

function getBadgeColor(score: number): string {
  if (score < 0.3) return 'bg-red-500/20 text-red-400';
  if (score < 0.5) return 'bg-orange-500/20 text-orange-400';
  if (score < 0.7) return 'bg-yellow-500/20 text-yellow-400';
  if (score < 0.85) return 'bg-emerald-500/20 text-emerald-400';
  return 'bg-green-500/20 text-green-400';
}

export default function StatusBadge({ score }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'px-2 py-0.5 rounded-full text-xs font-semibold',
        getBadgeColor(score),
      )}
    >
      {score.toFixed(2)}
    </span>
  );
}
