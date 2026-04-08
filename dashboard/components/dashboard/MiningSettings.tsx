'use client';

import { useState, useEffect } from 'react';
import useSWR, { mutate } from 'swr';
import { Settings, Gauge, Clock, Download, Zap } from 'lucide-react';
import GlassCard from '@/components/ui/GlassCard';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const SPEED_OPTIONS = [
  { value: 'low', label: 'Low', desc: 'Minimal impact, ~25% CPU' },
  { value: 'medium', label: 'Medium', desc: 'Balanced, ~50% CPU' },
  { value: 'high', label: 'High', desc: 'Faster results, ~75% CPU' },
  { value: 'maximum', label: 'Maximum', desc: 'Full power, all cores' },
];

const MODE_OPTIONS = [
  { value: 'always', label: 'Always On', desc: 'Mine 24/7', icon: Zap },
  { value: 'scheduled', label: 'Custom Hours', desc: 'Mine during specific hours', icon: Clock },
  { value: 'queue', label: 'Download Queue', desc: 'Download at night, process by day', icon: Download },
];

const HOURS = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: `${i.toString().padStart(2, '0')}:00`,
}));

interface SettingsData {
  speed: string;
  mode: string;
  schedule_start: number;
  schedule_end: number;
  download_start: number;
  download_end: number;
}

const DEFAULTS: SettingsData = {
  speed: 'medium',
  mode: 'always',
  schedule_start: 8,
  schedule_end: 22,
  download_start: 22,
  download_end: 6,
};

interface MiningSettingsProps {
  username: string;
}

export default function MiningSettings({ username }: MiningSettingsProps) {
  const { data } = useSWR(`/api/user/${username}/settings`, fetcher);

  const [settings, setSettings] = useState<SettingsData>(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) {
      setSettings({
        speed: data.speed || DEFAULTS.speed,
        mode: data.mode || DEFAULTS.mode,
        schedule_start: data.schedule_start ?? DEFAULTS.schedule_start,
        schedule_end: data.schedule_end ?? DEFAULTS.schedule_end,
        download_start: data.download_start ?? DEFAULTS.download_start,
        download_end: data.download_end ?? DEFAULTS.download_end,
      });
    }
  }, [data]);

  const saveSettings = async (updated: SettingsData) => {
    setSaving(true);
    setSaved(false);
    try {
      await fetch(`/api/user/${username}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      mutate(`/api/user/${username}/settings`);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { /* ignore */ }
    setSaving(false);
  };

  const update = (partial: Partial<SettingsData>) => {
    const updated = { ...settings, ...partial };
    setSettings(updated);
    saveSettings(updated);
  };

  return (
    <GlassCard className="mb-8" hover={false}>
      <div className="flex items-center gap-2 mb-5">
        <Settings className="w-5 h-5 text-emerald-400" />
        <h2 className="text-lg font-semibold text-white">Mining Settings</h2>
        {saved && <span className="ml-auto text-xs text-emerald-400">Saved</span>}
        {saving && <span className="ml-auto text-xs text-gray-500">Saving...</span>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Speed */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Gauge className="w-4 h-4 text-gray-400" />
            <span className="text-sm font-medium text-gray-300">Mining Speed</span>
          </div>
          <div className="space-y-1.5">
            {SPEED_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => update({ speed: opt.value })}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-left transition-all duration-200 ${
                  settings.speed === opt.value
                    ? 'bg-emerald-500/15 border border-emerald-500/40 text-white'
                    : 'bg-white/5 border border-transparent hover:bg-white/10 text-gray-400'
                }`}
              >
                <div>
                  <span className={`text-sm font-medium ${settings.speed === opt.value ? 'text-emerald-300' : ''}`}>
                    {opt.label}
                  </span>
                  <p className="text-xs text-gray-500 mt-0.5">{opt.desc}</p>
                </div>
                {settings.speed === opt.value && (
                  <svg className="w-4 h-4 text-emerald-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Mode + Schedule */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4 text-gray-400" />
            <span className="text-sm font-medium text-gray-300">Schedule</span>
          </div>
          <div className="space-y-1.5">
            {MODE_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              return (
                <button
                  key={opt.value}
                  onClick={() => update({ mode: opt.value })}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-left transition-all duration-200 ${
                    settings.mode === opt.value
                      ? 'bg-emerald-500/15 border border-emerald-500/40 text-white'
                      : 'bg-white/5 border border-transparent hover:bg-white/10 text-gray-400'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    <div>
                      <span className={`text-sm font-medium ${settings.mode === opt.value ? 'text-emerald-300' : ''}`}>
                        {opt.label}
                      </span>
                      <p className="text-xs text-gray-500 mt-0.5">{opt.desc}</p>
                    </div>
                  </div>
                  {settings.mode === opt.value && (
                    <svg className="w-4 h-4 text-emerald-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>

          {/* Time pickers for scheduled mode */}
          {settings.mode === 'scheduled' && (
            <div className="mt-4 p-3 rounded-lg bg-white/5 border border-white/10">
              <p className="text-xs text-gray-400 mb-2">Mine between:</p>
              <div className="flex items-center gap-2">
                <select
                  value={settings.schedule_start}
                  onChange={(e) => update({ schedule_start: Number(e.target.value) })}
                  className="bg-white/10 border border-white/10 rounded-md px-2 py-1.5 text-sm text-gray-300 focus:border-emerald-500/50 focus:outline-none"
                >
                  {HOURS.map((h) => (
                    <option key={h.value} value={h.value}>{h.label}</option>
                  ))}
                </select>
                <span className="text-gray-500 text-sm">to</span>
                <select
                  value={settings.schedule_end}
                  onChange={(e) => update({ schedule_end: Number(e.target.value) })}
                  className="bg-white/10 border border-white/10 rounded-md px-2 py-1.5 text-sm text-gray-300 focus:border-emerald-500/50 focus:outline-none"
                >
                  {HOURS.map((h) => (
                    <option key={h.value} value={h.value}>{h.label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Time pickers for queue mode */}
          {settings.mode === 'queue' && (
            <div className="mt-4 space-y-3">
              <div className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/20">
                <div className="flex items-center gap-1.5 mb-2">
                  <Download className="w-3.5 h-3.5 text-blue-400" />
                  <p className="text-xs text-blue-300">Download window</p>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={settings.download_start}
                    onChange={(e) => update({ download_start: Number(e.target.value) })}
                    className="bg-white/10 border border-white/10 rounded-md px-2 py-1.5 text-sm text-gray-300 focus:border-blue-500/50 focus:outline-none"
                  >
                    {HOURS.map((h) => (
                      <option key={h.value} value={h.value}>{h.label}</option>
                    ))}
                  </select>
                  <span className="text-gray-500 text-sm">to</span>
                  <select
                    value={settings.download_end}
                    onChange={(e) => update({ download_end: Number(e.target.value) })}
                    className="bg-white/10 border border-white/10 rounded-md px-2 py-1.5 text-sm text-gray-300 focus:border-blue-500/50 focus:outline-none"
                  >
                    {HOURS.map((h) => (
                      <option key={h.value} value={h.value}>{h.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                <div className="flex items-center gap-1.5 mb-2">
                  <Zap className="w-3.5 h-3.5 text-amber-400" />
                  <p className="text-xs text-amber-300">Process window</p>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={settings.schedule_start}
                    onChange={(e) => update({ schedule_start: Number(e.target.value) })}
                    className="bg-white/10 border border-white/10 rounded-md px-2 py-1.5 text-sm text-gray-300 focus:border-amber-500/50 focus:outline-none"
                  >
                    {HOURS.map((h) => (
                      <option key={h.value} value={h.value}>{h.label}</option>
                    ))}
                  </select>
                  <span className="text-gray-500 text-sm">to</span>
                  <select
                    value={settings.schedule_end}
                    onChange={(e) => update({ schedule_end: Number(e.target.value) })}
                    className="bg-white/10 border border-white/10 rounded-md px-2 py-1.5 text-sm text-gray-300 focus:border-amber-500/50 focus:outline-none"
                  >
                    {HOURS.map((h) => (
                      <option key={h.value} value={h.value}>{h.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </GlassCard>
  );
}
