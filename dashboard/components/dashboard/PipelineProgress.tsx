'use client';

import useSWR from 'swr';
import { Activity, Clock, Moon } from 'lucide-react';
import GlassCard from '@/components/ui/GlassCard';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface PipelineProgressProps {
  username: string;
}

export default function PipelineProgress({ username }: PipelineProgressProps) {
  const { data, error } = useSWR(
    `/api/user/${username}/progress`,
    fetcher,
    { refreshInterval: 5000 }
  );
  const { data: settings } = useSWR(
    `/api/user/${username}/settings`,
    fetcher
  );

  const isActive = data?.active === true;
  const steps = data?.steps || [];

  return (
    <GlassCard className="h-full" hover={false}>
      <div className="flex items-center gap-2 mb-4">
        <Activity className="w-5 h-5 text-emerald-400" />
        <h2 className="text-lg font-semibold text-white">Pipeline Progress</h2>
        {isActive && (
          <span className="ml-auto px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
            LIVE
          </span>
        )}
      </div>

      {error ? (
        <p className="text-gray-500 text-sm">Unable to load pipeline status.</p>
      ) : !isActive ? (
        <div className="flex flex-col items-center py-6 text-gray-500">
          {settings?.mode === 'scheduled' || settings?.mode === 'queue' ? (
            <>
              <div className="w-10 h-10 rounded-full border-2 border-dashed border-gray-600 flex items-center justify-center mb-3">
                <Moon className="w-5 h-5 text-gray-600" />
              </div>
              <p className="text-sm">Pipeline is sleeping</p>
              <p className="text-xs text-gray-600 mt-1 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Resumes at {String(settings.schedule_start).padStart(2, '0')}:00
              </p>
            </>
          ) : (
            <>
              <div className="w-10 h-10 rounded-full border-2 border-dashed border-gray-600 flex items-center justify-center mb-3">
                <Activity className="w-5 h-5 text-gray-600" />
              </div>
              <p className="text-sm">Waiting for pipeline to start...</p>
              <p className="text-xs text-gray-600 mt-1">Progress will appear here when the Docker container begins processing.</p>
            </>
          )}
        </div>
      ) : (
        <>
          {/* Current sample */}
          <div className="mb-5 px-4 py-3.5 rounded-xl bg-gradient-to-r from-emerald-500/10 to-transparent border border-emerald-500/20">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-emerald-400 font-mono text-sm font-semibold">{data.sample}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/20">{data.environment}</span>
            </div>
            {data.description && (
              <p className="text-sm text-gray-300 mt-2 leading-relaxed">{data.description}</p>
            )}
            {data.sample_size_mb > 0 && steps[0]?.status !== 'running' && (
              <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                <span>{data.sample_size_mb} MB</span>
                {data.sample_bases > 0 && <span>{(data.sample_bases / 1_000_000).toFixed(1)}M bases</span>}
              </div>
            )}
          </div>

          {/* Download info - show elapsed time + sample size, no fake progress bar */}
          {data.sample_size_mb > 0 && steps[0]?.status === 'running' && (
            <div className="mb-4 px-2">
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>Downloading {data.sample_size_mb} MB sample{data.sample_bases > 0 ? ` (${(data.sample_bases / 1_000_000).toFixed(0)}M bases)` : ''}</span>
                <span className="text-emerald-400/60 animate-pulse">transferring...</span>
              </div>
              <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden mt-1">
                <div className="h-full bg-emerald-500/40 rounded-full animate-[indeterminate_2s_ease-in-out_infinite]" style={{ width: '30%' }} />
              </div>
            </div>
          )}

          {/* Steps list */}
          <div className="space-y-1.5">
            {steps.map((step: { name: string; key: string; status: string; duration: string | null }, i: number) => (
              <div key={step.key} className="flex items-center gap-3 py-1.5 px-2 rounded-md hover:bg-white/5 transition-colors">
                {/* Step number */}
                <span className="text-xs text-gray-600 w-5 text-right font-mono">{i + 1}.</span>

                {/* Status indicator */}
                <div className="flex-shrink-0 w-5 flex items-center justify-center">
                  {step.status === 'done' && (
                    <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                  {step.status === 'running' && (
                    <span className="relative flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
                    </span>
                  )}
                  {step.status === 'skipped' && (
                    <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                    </svg>
                  )}
                  {step.status === 'pending' && (
                    <span className="inline-flex rounded-full h-2.5 w-2.5 border border-gray-600" />
                  )}
                </div>

                {/* Step name */}
                <span className={`flex-1 text-sm ${
                  step.status === 'done' ? 'text-gray-300' :
                  step.status === 'running' ? 'text-white font-medium' :
                  step.status === 'skipped' ? 'text-gray-600 line-through' :
                  'text-gray-600'
                }`}>
                  {step.name}
                </span>

                {/* Duration / status label */}
                <span className={`text-xs font-mono ${
                  step.status === 'done' ? 'text-gray-500' :
                  step.status === 'running' ? 'text-emerald-400' :
                  'text-gray-700'
                }`}>
                  {step.status === 'done' && step.duration ? step.duration : ''}
                  {step.status === 'running' ? 'running...' : ''}
                  {step.status === 'skipped' ? 'n/a (lite)' : ''}
                  {step.status === 'pending' ? 'pending' : ''}
                </span>
              </div>
            ))}
          </div>

          {/* Session stats */}
          {(data.session_completed > 0 || data.session_skipped > 0) && (
            <div className="mt-4 pt-3 border-t border-white/10 text-xs text-gray-500">
              {data.session_completed > 0 && (
                <span className="text-emerald-400/80">{data.session_completed} completed</span>
              )}
              {data.session_completed > 0 && data.session_skipped > 0 && (
                <span className="mx-1">,</span>
              )}
              {data.session_skipped > 0 && (
                <span className="text-amber-400/80">{data.session_skipped} skipped</span>
              )}
              <span> this session</span>
            </div>
          )}
        </>
      )}
    </GlassCard>
  );
}
