'use client';

import { cn } from '@/lib/utils';

interface Tab {
  id: string;
  label: string;
}

interface PillTabsProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (id: string) => void;
}

export default function PillTabs({ tabs, activeTab, onChange }: PillTabsProps) {
  return (
    <div className="flex flex-row gap-2">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            'px-4 py-2 rounded-xl text-sm font-medium transition-all',
            activeTab === tab.id
              ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/25'
              : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
