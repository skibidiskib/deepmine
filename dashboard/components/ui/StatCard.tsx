'use client';

import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import GlassCard from './GlassCard';
import AnimatedCounter from './AnimatedCounter';
import { cn } from '@/lib/utils';

interface StatCardProps {
  title: string;
  value: number;
  icon: LucideIcon;
  color: string;
  delta?: string;
  prefix?: string;
  suffix?: string;
  index?: number;
}

export default function StatCard({
  title,
  value,
  icon: Icon,
  color,
  delta,
  prefix,
  suffix,
  index = 0,
}: StatCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: index * 0.1 }}
    >
      <GlassCard
        hover
        className={cn('relative overflow-hidden border-l-4', color)}
      >
        <Icon className="absolute top-3 right-3 sm:top-4 sm:right-4 w-6 h-6 sm:w-8 sm:h-8 text-white opacity-40" />
        <p className="text-xs sm:text-sm text-gray-400 mb-0.5 sm:mb-1">{title}</p>
        <div className="text-2xl sm:text-3xl font-bold text-white">
          <AnimatedCounter value={value} prefix={prefix} suffix={suffix} />
        </div>
        {delta && (
          <p
            className={cn(
              'text-xs mt-2',
              delta.startsWith('+') ? 'text-emerald-400' : 'text-gray-500',
            )}
          >
            {delta}
          </p>
        )}
      </GlassCard>
    </motion.div>
  );
}
