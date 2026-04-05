'use client';

import { cn } from '@/lib/utils';

interface GlassCardProps {
  className?: string;
  children: React.ReactNode;
  hover?: boolean;
}

export default function GlassCard({
  className,
  children,
  hover = true,
}: GlassCardProps) {
  return (
    <div
      className={cn(
        'rounded-xl sm:rounded-2xl p-4 sm:p-6 bg-gradient-to-br from-white/5 to-white/10 backdrop-blur-md border border-white/15 shadow-xl',
        hover &&
          'hover:shadow-2xl hover:border-emerald-500/30 transition-all duration-300',
        className,
      )}
    >
      {children}
    </div>
  );
}
