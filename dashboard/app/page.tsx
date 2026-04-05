'use client';

import HeroStats from '@/components/dashboard/HeroStats';
import DiscoveryTimeline from '@/components/dashboard/DiscoveryTimeline';
import Leaderboard from '@/components/dashboard/Leaderboard';
import BGCTypeChart from '@/components/dashboard/BGCTypeChart';
import ActivityHistogram from '@/components/dashboard/ActivityHistogram';
import NoveltyGauge from '@/components/dashboard/NoveltyGauge';
import LiveFeed from '@/components/dashboard/LiveFeed';
import GlassCard from '@/components/ui/GlassCard';
import useSWR from 'swr';
import { Microscope } from 'lucide-react';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function DashboardPage() {
  const { data: stats } = useSWR('/api/stats', fetcher, { refreshInterval: 30000 });

  const noveltyPct =
    stats && stats.total_bgcs > 0
      ? Math.round((stats.total_novel / stats.total_bgcs) * 100)
      : 0;

  return (
    <div className="min-h-screen pb-8 sm:pb-12">
      <div className="max-w-[1400px] mx-auto px-3 sm:px-6 lg:px-8">
        {/* Page Title */}
        <section className="mb-6 sm:mb-8 pt-4 sm:pt-6">
          <div className="flex items-center gap-2 sm:gap-3 mb-1.5 sm:mb-2">
            <Microscope className="w-6 h-6 sm:w-8 sm:h-8 text-emerald-400" />
            <h1 className="text-xl sm:text-3xl font-bold text-white">
              Community <span className="bg-gradient-to-r from-emerald-400 to-emerald-200 bg-clip-text text-transparent">Dashboard</span>
            </h1>
          </div>
          <p className="text-gray-400 text-xs sm:text-sm max-w-2xl">
            Tracking global contributions to antibiotic discovery through metagenomic mining.
            Every biosynthetic gene cluster (BGC) found brings us closer to new medicines.
          </p>
        </section>

        {/* Hero Stats */}
        <section className="mb-6 sm:mb-8">
          <HeroStats />
        </section>

        {/* Timeline + Leaderboard */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 mb-6 sm:mb-8">
          <div className="lg:col-span-2 flex">
            <DiscoveryTimeline className="w-full" />
          </div>
          <div className="flex">
            <Leaderboard className="w-full" />
          </div>
        </section>

        {/* Charts Row */}
        <section className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6 mb-6 sm:mb-8">
          <BGCTypeChart />
          <ActivityHistogram />
          <GlassCard hover={false} className="sm:col-span-2 md:col-span-1">
            <h2 className="text-lg font-semibold text-white mb-4">Novelty Rate</h2>
            <div className="flex items-center justify-center">
              <NoveltyGauge percentage={noveltyPct} />
            </div>
            <p className="text-center text-xs text-gray-500 mt-2">
              Percentage of BGCs that are novel (distant from known MIBiG families)
            </p>
          </GlassCard>
        </section>

        {/* Live Feed */}
        <section className="mb-6 sm:mb-8">
          <LiveFeed />
        </section>
      </div>
    </div>
  );
}
