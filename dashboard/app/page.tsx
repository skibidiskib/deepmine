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
import { useState } from 'react';
import { Microscope, Dna, Terminal, Globe, Sparkles, ChevronDown, Zap, Layers, Cpu } from 'lucide-react';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const TIER_COMMANDS: Record<string, string> = {
  lite: 'npm install -g deepmine && deepmine',
  standard: 'DEEPMINE_TIER=standard npm install -g deepmine && deepmine',
  full: 'DEEPMINE_TIER=full npm install -g deepmine && deepmine',
};

export default function DashboardPage() {
  const { data: stats } = useSWR('/api/stats', fetcher, { refreshInterval: 30000 });

  const [selectedTier, setSelectedTier] = useState<string>('lite');
  const [copyText, setCopyText] = useState('Copy');

  const noveltyPct =
    stats && stats.total_bgcs > 0
      ? Math.round((stats.total_novel / stats.total_bgcs) * 100)
      : 0;

  return (
    <div className="min-h-screen pb-8 sm:pb-12">
      {/* Hero / Landing Section */}
      <section className="relative flex flex-col items-center justify-center px-4 text-center overflow-hidden py-12 sm:py-16">
        {/* Ambient glow */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-emerald-500/10 blur-[120px]" />
          <div className="absolute bottom-0 left-1/3 w-[400px] h-[400px] rounded-full bg-emerald-700/5 blur-[100px]" />
        </div>

        <div className="relative z-10 max-w-4xl mx-auto space-y-6">
          {/* Icon cluster */}
          <div className="flex items-center justify-center gap-3 text-emerald-400/60">
            <Dna className="w-5 h-5 animate-float" />
            <Globe className="w-5 h-5 animate-float" style={{ animationDelay: '1s' }} />
            <Sparkles className="w-5 h-5 animate-float" style={{ animationDelay: '2s' }} />
          </div>

          {/* Title */}
          <h1 className="text-5xl sm:text-7xl font-extrabold tracking-tight gradient-text leading-tight">
            DEEPMINE
          </h1>

          {/* Subtitle */}
          <p className="text-lg sm:text-xl font-medium text-emerald-300/90">
            Mining Earth&#39;s Microbiome for New Antibiotics
          </p>

          {/* How it works */}
          <p className="text-sm sm:text-base text-gray-400 max-w-xl mx-auto leading-relaxed">
            Install, pick a username, choose your tier. Your computer mines
            metagenomic data for novel antibiotics while you sleep.
          </p>

          {/* Tier cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 max-w-3xl mx-auto pt-2">
            {/* Lite */}
            <button
              onClick={() => setSelectedTier('lite')}
              className={`rounded-xl p-4 sm:p-5 text-left relative transition-all duration-300 cursor-pointer border ${
                selectedTier === 'lite'
                  ? 'border-emerald-400 bg-emerald-500/20 ring-2 ring-emerald-500/40 scale-[1.03] shadow-lg shadow-emerald-500/10'
                  : 'glass border-white/10 opacity-60 hover:opacity-80 hover:border-white/20'
              }`}
            >
              <span className="absolute top-2.5 right-2.5 text-[10px] uppercase tracking-wider font-semibold bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-500/30">
                Recommended
              </span>
              <Zap className={`w-5 h-5 mb-2 ${selectedTier === 'lite' ? 'text-emerald-300' : 'text-emerald-400/50'}`} />
              <h3 className="text-base font-bold text-white">Lite</h3>
              <p className="text-xs text-emerald-400/80 font-mono mb-1.5">~2 GB</p>
              <p className={`text-xs leading-relaxed ${selectedTier === 'lite' ? 'text-gray-300' : 'text-gray-500'}`}>
                Fast, lightweight BGC detection using GECCO only.
              </p>
            </button>

            {/* Standard */}
            <button
              onClick={() => setSelectedTier('standard')}
              className={`rounded-xl p-4 sm:p-5 text-left transition-all duration-300 cursor-pointer border ${
                selectedTier === 'standard'
                  ? 'border-emerald-400 bg-emerald-500/20 ring-2 ring-emerald-500/40 scale-[1.03] shadow-lg shadow-emerald-500/10'
                  : 'glass border-white/10 opacity-60 hover:opacity-80 hover:border-white/20'
              }`}
            >
              <Layers className={`w-5 h-5 mb-2 ${selectedTier === 'standard' ? 'text-emerald-300' : 'text-emerald-400/50'}`} />
              <h3 className="text-base font-bold text-white">Standard</h3>
              <p className="text-xs text-emerald-400/80 font-mono mb-1.5">~5 GB</p>
              <p className={`text-xs leading-relaxed ${selectedTier === 'standard' ? 'text-gray-300' : 'text-gray-500'}`}>
                Better accuracy with 3 detection tools.
              </p>
            </button>

            {/* Full */}
            <button
              onClick={() => setSelectedTier('full')}
              className={`rounded-xl p-4 sm:p-5 text-left transition-all duration-300 cursor-pointer border ${
                selectedTier === 'full'
                  ? 'border-emerald-400 bg-emerald-500/20 ring-2 ring-emerald-500/40 scale-[1.03] shadow-lg shadow-emerald-500/10'
                  : 'glass border-white/10 opacity-60 hover:opacity-80 hover:border-white/20'
              }`}
            >
              <Cpu className={`w-5 h-5 mb-2 ${selectedTier === 'full' ? 'text-emerald-300' : 'text-emerald-400/50'}`} />
              <h3 className="text-base font-bold text-white">Full</h3>
              <p className="text-xs text-emerald-400/80 font-mono mb-1.5">~12 GB</p>
              <p className={`text-xs leading-relaxed ${selectedTier === 'full' ? 'text-gray-300' : 'text-gray-500'}`}>
                Best accuracy with ML scoring. GPU recommended.
              </p>
            </button>
          </div>

          {/* Install command (changes based on selected tier) */}
          <div className="glass rounded-lg px-4 py-3 sm:px-6 sm:py-4 max-w-3xl mx-auto">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2 text-emerald-400/70">
                <Terminal className="w-4 h-4" />
                <span className="text-xs uppercase tracking-wider font-semibold">Quick Start</span>
              </div>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(TIER_COMMANDS[selectedTier]);
                  setCopyText('Copied!');
                  setTimeout(() => setCopyText('Copy'), 2000);
                }}
                className="text-xs text-gray-400 hover:text-emerald-300 transition-colors px-2 py-0.5 rounded border border-white/10 hover:border-emerald-500/30"
              >
                {copyText}
              </button>
            </div>
            <code className="block text-sm sm:text-base text-emerald-300 font-mono break-all">
              {TIER_COMMANDS[selectedTier]}
            </code>
          </div>

          {/* Scroll indicator */}
          <a
            href="#dashboard"
            className="inline-flex flex-col items-center gap-1 text-gray-500 hover:text-emerald-400 transition-colors mt-4"
          >
            <span className="text-xs tracking-wide uppercase">See live results below</span>
            <ChevronDown className="w-5 h-5 animate-bounce" />
          </a>
        </div>
      </section>

      <div id="dashboard" className="max-w-[1400px] mx-auto px-3 sm:px-6 lg:px-8">
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
