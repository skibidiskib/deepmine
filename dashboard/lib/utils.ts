import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

export function formatScore(score: number): string {
  return score.toFixed(2);
}

export function formatDate(iso: string): string {
  // DB stores UTC timestamps without 'Z' suffix, so append it for correct parsing
  const date = new Date(iso.includes('T') || iso.includes('Z') ? iso : iso + 'Z');
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function getScoreColor(score: number): string {
  if (score < 0.3) return 'text-red-400';
  if (score < 0.5) return 'text-orange-400';
  if (score < 0.7) return 'text-yellow-400';
  if (score < 0.85) return 'text-emerald-400';
  return 'text-green-400';
}

export function getBGCTypeColor(type: string): string {
  const colors: Record<string, string> = {
    NRPS: '#10b981',
    PKS: '#3b82f6',
    RiPP: '#f59e0b',
    terpene: '#8b5cf6',
    hybrid: '#ec4899',
  };
  return colors[type] ?? '#6b7280';
}

export function getEnvironmentColor(env: string): string {
  const colors: Record<string, string> = {
    cave: '#8b5cf6',
    deep_sea: '#3b82f6',
    hot_spring: '#ef4444',
    permafrost: '#06b6d4',
    soil: '#84cc16',
    freshwater: '#22d3ee',
    marine_sediment: '#6366f1',
    desert: '#f59e0b',
    volcanic: '#dc2626',
    glacier: '#a5f3fc',
    mangrove: '#16a34a',
    coral_reef: '#f472b6',
  };
  return colors[env] ?? '#6b7280';
}
