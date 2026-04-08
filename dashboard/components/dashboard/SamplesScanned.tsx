'use client';

import useSWR from 'swr';
import { FlaskConical } from 'lucide-react';
import GlassCard from '@/components/ui/GlassCard';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const ENV_COLORS: Record<string, string> = {
  cave: 'bg-purple-500/20 text-purple-300',
  'hot spring': 'bg-red-500/20 text-red-300',
  'hot_spring': 'bg-red-500/20 text-red-300',
  'deep-sea vent': 'bg-blue-500/20 text-blue-300',
  'deep_sea_vent': 'bg-blue-500/20 text-blue-300',
  'hydrothermal vent': 'bg-blue-500/20 text-blue-300',
  permafrost: 'bg-cyan-500/20 text-cyan-300',
  'acid mine': 'bg-amber-500/20 text-amber-300',
  'marine sediment': 'bg-teal-500/20 text-teal-300',
  'marine_sediment': 'bg-teal-500/20 text-teal-300',
  soil: 'bg-orange-500/20 text-orange-300',
  mangrove: 'bg-green-500/20 text-green-300',
};

function envColor(env: string): string {
  const key = env.toLowerCase();
  for (const [k, v] of Object.entries(ENV_COLORS)) {
    if (key.includes(k)) return v;
  }
  return 'bg-gray-500/20 text-gray-300';
}

interface SampleEntry {
  sample: string;
  environment: string;
  description: string;
  bgcs_found: number;
  top_score?: number;
  status: 'completed' | 'skipped' | 'processing';
  current_step?: string;
}

export default function SamplesScanned({ username }: { username: string }) {
  const { data: progressData } = useSWR(
    `/api/user/${username}/progress`,
    fetcher,
    { refreshInterval: 3000 }
  );
  const { data: userData } = useSWR(`/api/user/${username}`, fetcher);

  // Build unified sample list from session history + DB runs
  const samples: SampleEntry[] = [];

  // 1. Session samples from progress (current session, most recent first)
  if (progressData?.session_samples) {
    for (const s of [...progressData.session_samples].reverse()) {
      samples.push({
        sample: s.sample,
        environment: s.environment,
        description: s.description,
        bgcs_found: s.bgcs_found || 0,
        status: s.status === 'skipped' ? 'skipped' : 'completed',
      });
    }
  }

  // 2. Current sample (in progress)
  if (progressData?.active && progressData?.sample) {
    const runningStep = (progressData.steps || []).find(
      (s: { status: string; name: string }) => s.status === 'running'
    );

    samples.unshift({
      sample: progressData.sample,
      environment: progressData.environment,
      description: progressData.description,
      bgcs_found: 0,
      status: 'processing',
      top_score: undefined,
      current_step: runningStep?.name || undefined,
    });
  }

  // 3. Merge DB run data (authoritative BGC counts) into session samples + add historical
  if (userData?.runs) {
    // Build lookup: accession -> {bgcs_found, top_score, environment}
    const dbLookup = new Map<string, { bgcs_found: number; top_score: number; environment: string }>();
    for (const run of userData.runs) {
      const parts = run.run_id.split('_');
      const accession = parts.length >= 2 ? parts[1] : run.run_id;
      const existing = dbLookup.get(accession);
      // Keep the one with most BGCs (in case of duplicate runs)
      if (!existing || run.bgcs_found > existing.bgcs_found) {
        dbLookup.set(accession, {
          bgcs_found: run.bgcs_found || 0,
          top_score: run.top_score || 0,
          environment: run.environment || '',
        });
      }
    }

    // Update session samples with DB data
    const sessionAccessions = new Set<string>();
    for (const s of samples) {
      sessionAccessions.add(s.sample);
      const db = dbLookup.get(s.sample);
      if (db) {
        s.bgcs_found = db.bgcs_found;
        s.top_score = db.top_score;
      }
    }

    // Add historical runs not in current session
    for (const [accession, db] of dbLookup) {
      if (sessionAccessions.has(accession)) continue;
      samples.push({
        sample: accession,
        environment: db.environment,
        description: '',
        bgcs_found: db.bgcs_found,
        top_score: db.top_score,
        status: 'completed',
      });
    }
  }

  // Sort: processing first, then discoveries (most BGCs first), then 0-BGC completed, then skipped
  samples.sort((a, b) => {
    if (a.status === 'processing') return -1;
    if (b.status === 'processing') return 1;
    if (a.bgcs_found !== b.bgcs_found) return b.bgcs_found - a.bgcs_found;
    if (a.status === 'skipped') return 1;
    if (b.status === 'skipped') return -1;
    return 0;
  });

  const totalBGCs = samples.reduce((sum, s) => sum + s.bgcs_found, 0);

  return (
    <GlassCard className="h-full">
      <div className="flex items-center gap-2 mb-4">
        <FlaskConical className="w-5 h-5 text-emerald-400" />
        <h2 className="text-lg font-semibold text-white">
          Samples Scanned
        </h2>
        {samples.length > 0 && (
          <span className="ml-auto text-xs text-gray-500">
            {samples.length} samples, {totalBGCs} BGCs
          </span>
        )}
      </div>

      {samples.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <FlaskConical className="w-8 h-8 text-gray-600 mb-2 opacity-50" />
          <p className="text-sm text-gray-500">No samples processed yet</p>
          <p className="text-xs text-gray-600 mt-1">
            Results will appear here as samples complete
          </p>
        </div>
      ) : (
        <div className="space-y-1.5 max-h-[400px] overflow-y-auto pr-1">
          {samples.map((s, i) => (
            <div
              key={`${s.sample}-${i}`}
              className={`flex items-center gap-2 px-2.5 py-2 rounded-lg transition-colors ${
                s.status === 'processing'
                  ? 'bg-emerald-500/5 border border-emerald-500/20'
                  : s.status === 'skipped'
                  ? 'bg-white/[0.02]'
                  : 'bg-white/[0.03] hover:bg-white/[0.06]'
              }`}
            >
              {/* Status dot */}
              <div className="flex-shrink-0 w-4 flex items-center justify-center">
                {s.status === 'processing' ? (
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                  </span>
                ) : s.status === 'skipped' ? (
                  <span className="inline-flex rounded-full h-2 w-2 bg-gray-600" />
                ) : (
                  <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>

              {/* Sample info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-gray-300 truncate">
                    {s.sample}
                  </span>
                  {s.environment && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 ${envColor(s.environment)}`}>
                      {s.environment}
                    </span>
                  )}
                </div>
                {s.description && (
                  <p className="text-[11px] text-gray-600 truncate mt-0.5">
                    {s.description}
                  </p>
                )}
              </div>

              {/* Scoring */}
              <div className="flex-shrink-0 text-right">
                {s.status === 'processing' ? (
                  <span className="text-xs text-emerald-400">{s.current_step || 'processing...'}</span>
                ) : s.status === 'skipped' ? (
                  <span className="text-xs text-gray-600">skipped</span>
                ) : (
                  <div>
                    <span className={`text-xs font-mono ${
                      s.bgcs_found > 0 ? 'text-amber-400' : 'text-gray-500'
                    }`}>
                      {s.bgcs_found} BGC{s.bgcs_found !== 1 ? 's' : ''}
                    </span>
                    {s.top_score != null && s.top_score > 0 && (
                      <div className={`text-[10px] font-mono ${
                        s.top_score >= 0.8 ? 'text-emerald-400' :
                        s.top_score >= 0.5 ? 'text-amber-400' :
                        'text-gray-500'
                      }`}>
                        top: {s.top_score.toFixed(2)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  );
}
