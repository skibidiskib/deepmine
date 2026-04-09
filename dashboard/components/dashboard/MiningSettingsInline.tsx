'use client';

import { useState, useEffect } from 'react';
import useSWR, { mutate } from 'swr';
import { Gauge, Clock, Download, Zap, Wifi } from 'lucide-react';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const SPEED_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'maximum', label: 'Max' },
];

const MODE_OPTIONS = [
  { value: 'always', label: '24/7' },
  { value: 'scheduled', label: 'Hours' },
  { value: 'queue', label: 'Queue' },
];

const BANDWIDTH_OPTIONS = [
  { value: '512kb', label: '512 KB/s' },
  { value: '1mb', label: '1 MB/s' },
  { value: '2mb', label: '2 MB/s' },
  { value: '5mb', label: '5 MB/s' },
  { value: '10mb', label: '10 MB/s' },
  { value: 'unlimited', label: 'Unlimited' },
];

const HOURS = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: `${i.toString().padStart(2, '0')}:00`,
}));

interface Settings {
  speed: string;
  mode: string;
  bandwidth: string;
  schedule_start: number;
  schedule_end: number;
  download_start: number;
  download_end: number;
}

const DEFAULTS: Settings = {
  speed: 'medium',
  mode: 'always',
  bandwidth: '5mb',
  schedule_start: 8,
  schedule_end: 22,
  download_start: 22,
  download_end: 6,
};

export default function MiningSettingsInline({ username }: { username: string }) {
  const { data } = useSWR(`/api/user/${username}/settings`, fetcher);

  const [settings, setSettings] = useState<Settings>(DEFAULTS);

  useEffect(() => {
    if (data) {
      setSettings({
        speed: data.speed || DEFAULTS.speed,
        mode: data.mode || DEFAULTS.mode,
        bandwidth: data.bandwidth || DEFAULTS.bandwidth,
        schedule_start: data.schedule_start ?? DEFAULTS.schedule_start,
        schedule_end: data.schedule_end ?? DEFAULTS.schedule_end,
        download_start: data.download_start ?? DEFAULTS.download_start,
        download_end: data.download_end ?? DEFAULTS.download_end,
      });
    }
  }, [data]);

  const save = async (updated: Settings) => {
    try {
      await fetch(`/api/user/${username}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...updated, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      });
      mutate(`/api/user/${username}/settings`);
    } catch { /* ignore */ }
  };

  const update = (partial: Partial<Settings>) => {
    const updated = { ...settings, ...partial };
    setSettings(updated);
    save(updated);
  };

  const selectClass = "bg-white/5 border border-white/10 rounded-md px-2 py-1 text-xs text-gray-300 appearance-none cursor-pointer hover:border-emerald-500/30 focus:border-emerald-500/50 focus:outline-none pr-6 transition-colors";
  const chevronBg = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`;
  const selectStyle = { backgroundImage: chevronBg, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 6px center' } as React.CSSProperties;

  return (
    <div className="flex items-center gap-3 flex-shrink-0 flex-wrap">
      {/* Speed dropdown */}
      <div className="flex items-center gap-1.5 text-xs text-gray-500">
        <Gauge className="w-3 h-3" />
        <select
          value={settings.speed}
          onChange={(e) => update({ speed: e.target.value })}
          className={selectClass}
          style={selectStyle}
        >
          {SPEED_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Bandwidth dropdown */}
      <div className="flex items-center gap-1.5 text-xs text-gray-500">
        <Wifi className="w-3 h-3" />
        <select
          value={settings.bandwidth}
          onChange={(e) => update({ bandwidth: e.target.value })}
          className={selectClass}
          style={selectStyle}
        >
          {BANDWIDTH_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Mode: 24/7 */}
      <div className="flex items-center gap-0.5 text-xs">
        <button
          onClick={() => update({ mode: 'always' })}
          className={`px-2 py-1 rounded-md transition-colors ${
            settings.mode === 'always'
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
              : 'text-gray-500 hover:text-gray-300 border border-transparent'
          }`}
        >
          24/7
        </button>

        {/* Mode: Hours + inline time pickers */}
        <button
          onClick={() => update({ mode: 'scheduled' })}
          className={`px-2 py-1 rounded-md transition-colors ${
            settings.mode === 'scheduled'
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
              : 'text-gray-500 hover:text-gray-300 border border-transparent'
          }`}
        >
          Hours
        </button>
        {settings.mode === 'scheduled' && (
          <div className="flex items-center gap-1.5 text-xs text-gray-500 ml-1">
            <Clock className="w-3 h-3" />
            <select
              value={settings.schedule_start}
              onChange={(e) => update({ schedule_start: Number(e.target.value) })}
              className={selectClass}
              style={selectStyle}
            >
              {HOURS.map((h) => (
                <option key={h.value} value={h.value}>{h.label}</option>
              ))}
            </select>
            <span className="text-gray-600">to</span>
            <select
              value={settings.schedule_end}
              onChange={(e) => update({ schedule_end: Number(e.target.value) })}
              className={selectClass}
              style={selectStyle}
            >
              {HOURS.map((h) => (
                <option key={h.value} value={h.value}>{h.label}</option>
              ))}
            </select>
          </div>
        )}

        {/* Mode: Queue + inline time pickers */}
        <button
          onClick={() => update({ mode: 'queue' })}
          className={`px-2 py-1 rounded-md transition-colors ${
            settings.mode === 'queue'
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
              : 'text-gray-500 hover:text-gray-300 border border-transparent'
          }`}
        >
          Queue
        </button>
        {settings.mode === 'queue' && (
          <div className="flex items-center gap-1.5 text-xs text-gray-500 ml-1">
            <Download className="w-3 h-3 text-blue-400" />
            <select
              value={settings.download_start}
              onChange={(e) => update({ download_start: Number(e.target.value) })}
              className={selectClass}
              style={selectStyle}
            >
              {HOURS.map((h) => (
                <option key={h.value} value={h.value}>{h.label}</option>
              ))}
            </select>
            <span className="text-gray-600">to</span>
            <select
              value={settings.download_end}
              onChange={(e) => update({ download_end: Number(e.target.value) })}
              className={selectClass}
              style={selectStyle}
            >
              {HOURS.map((h) => (
                <option key={h.value} value={h.value}>{h.label}</option>
              ))}
            </select>
            <span className="text-gray-600 mx-1">dl</span>
            <Zap className="w-3 h-3 text-amber-400" />
            <select
              value={settings.schedule_start}
              onChange={(e) => update({ schedule_start: Number(e.target.value) })}
              className={selectClass}
              style={selectStyle}
            >
              {HOURS.map((h) => (
                <option key={h.value} value={h.value}>{h.label}</option>
              ))}
            </select>
            <span className="text-gray-600">to</span>
            <select
              value={settings.schedule_end}
              onChange={(e) => update({ schedule_end: Number(e.target.value) })}
              className={selectClass}
              style={selectStyle}
            >
              {HOURS.map((h) => (
                <option key={h.value} value={h.value}>{h.label}</option>
              ))}
            </select>
            <span className="text-gray-600 ml-0.5">run</span>
          </div>
        )}
      </div>
    </div>
  );
}
