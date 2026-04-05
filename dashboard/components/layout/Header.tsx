'use client';

import { Dna, ExternalLink } from 'lucide-react';
import LiveIndicator from '@/components/ui/LiveIndicator';

export default function Header() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 px-3 sm:px-6 py-2.5 sm:py-3 flex items-center justify-between bg-slate-950/80 backdrop-blur-md border-b border-white/10">
      <div className="flex items-center gap-2 sm:gap-3">
        <Dna className="w-6 h-6 sm:w-7 sm:h-7 text-emerald-400" />
        <div className="flex items-baseline gap-1.5 sm:gap-2">
          <span className="text-base sm:text-lg font-bold bg-gradient-to-r from-emerald-400 to-emerald-200 bg-clip-text text-transparent">
            DEEPMINE
          </span>
          <span className="text-xs sm:text-sm text-gray-400 hidden sm:inline">
            Community Dashboard
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3 sm:gap-4">
        <LiveIndicator />
        <a
          href="https://github.com/deepmine"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-gray-400 hover:text-white transition-colors text-sm"
        >
          <span className="hidden sm:inline">GitHub</span>
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>
    </header>
  );
}
