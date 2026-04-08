/**
 * In-memory pipeline progress store.
 *
 * Docker containers POST their current step here, and the user profile
 * page polls GET to show a real-time SETI@Home-style progress bar.
 * Data is ephemeral: it only lives as long as the server process.
 */

export interface StepProgress {
  name: string;
  key: string;
  status: 'done' | 'running' | 'pending' | 'skipped';
  duration: string | null;
}

export interface SessionSample {
  sample: string;
  environment: string;
  description: string;
  bgcs_found: number;
  status: 'completed' | 'skipped';
  completed_at: string;
}

export interface UserProgress {
  username: string;
  sample: string;
  environment: string;
  description: string;
  steps: StepProgress[];
  session_completed: number;
  session_skipped: number;
  session_samples: SessionSample[];
  sample_size_mb: number;
  sample_bases: number;
  downloaded_mb: number;
  updated_at: string;
}

export const PIPELINE_STEPS = [
  { key: 'download', name: 'Downloading reads' },
  { key: 'compress', name: 'Compressing reads' },
  { key: 'assembly', name: 'Assembling contigs' },
  { key: 'filter_contigs', name: 'Filtering contigs' },
  { key: 'gene_calling', name: 'Calling genes' },
  { key: 'antismash', name: 'Running antiSMASH' },
  { key: 'gecco', name: 'Detecting BGCs (GECCO)' },
  { key: 'deepbgc', name: 'Detecting BGCs (DeepBGC)' },
  { key: 'ensemble_merge', name: 'Merging detections' },
  { key: 'scoring', name: 'Scoring candidates' },
] as const;

// In-memory store keyed by username
const progressMap = new Map<string, UserProgress>();

export interface ProgressUpdate {
  username: string;
  sample: string;
  environment: string;
  description?: string;
  step: string;
  status: 'running' | 'done' | 'skipped';
  duration: string | null;
  session_completed: number;
  session_skipped: number;
  sample_size_mb?: number;
  sample_bases?: number;
  downloaded_mb?: number;
}

/**
 * Apply a progress update from a Docker container.
 *
 * When a step is reported as "running", all prior steps are marked "done"
 * (without overwriting durations already recorded). When a step is "done",
 * its duration is saved and it stays done.
 *
 * When the sample changes, the previous sample is archived into session_samples.
 */
export function updateProgress(update: ProgressUpdate): UserProgress {
  const existing = progressMap.get(update.username);

  // If the sample changed, archive the old sample into session history
  const sampleChanged = existing?.sample && existing.sample !== update.sample;
  let sessionSamples = existing?.session_samples || [];

  if (sampleChanged && existing) {
    // Count BGCs from completed steps (scoring done = pipeline finished)
    const pipelineFinished = existing.steps.some(
      (s) => s.key === 'scoring' && s.status === 'done'
    );
    const wasSkipped = existing.steps.some(
      (s) => s.key === 'filter_contigs' && s.status === 'done'
    ) && !pipelineFinished;

    sessionSamples = [
      ...sessionSamples,
      {
        sample: existing.sample,
        environment: existing.environment,
        description: existing.description,
        bgcs_found: 0, // Updated by submit API
        status: wasSkipped ? 'skipped' as const : 'completed' as const,
        completed_at: existing.updated_at,
      },
    ];
  }

  const stepIndex = PIPELINE_STEPS.findIndex((s) => s.key === update.step);

  // Build the steps array
  const steps: StepProgress[] = PIPELINE_STEPS.map((def, i) => {
    // Carry forward existing step data if same sample
    const prev = !sampleChanged ? existing?.steps[i] : undefined;

    // Handle "skipped" updates: mark this step as skipped and preserve everything else
    if (update.status === 'skipped' && i === stepIndex) {
      return {
        name: def.name,
        key: def.key,
        status: 'skipped' as const,
        duration: null,
      };
    }

    if (update.status === 'running') {
      if (i < stepIndex) {
        return {
          name: def.name,
          key: def.key,
          status: prev?.status === 'skipped' ? 'skipped' as const : 'done' as const,
          duration: prev?.status === 'done' ? prev.duration : null,
        };
      }
      if (i === stepIndex) {
        return {
          name: def.name,
          key: def.key,
          status: 'running' as const,
          duration: null,
        };
      }
      return {
        name: def.name,
        key: def.key,
        status: prev?.status === 'skipped' ? 'skipped' as const : 'pending' as const,
        duration: null,
      };
    }

    // status === 'done'
    if (i < stepIndex) {
      return {
        name: def.name,
        key: def.key,
        status: prev?.status === 'skipped' ? 'skipped' as const : 'done' as const,
        duration: prev?.status === 'done' ? prev.duration : null,
      };
    }
    if (i === stepIndex) {
      return {
        name: def.name,
        key: def.key,
        status: 'done' as const,
        duration: update.duration,
      };
    }
    return {
      name: def.name,
      key: def.key,
      status: prev?.status === 'skipped' ? 'skipped' as const : 'pending' as const,
      duration: null,
    };
  });

  const progress: UserProgress = {
    username: update.username,
    sample: update.sample,
    environment: update.environment,
    description: update.description || existing?.description || '',
    steps,
    session_completed: update.session_completed,
    session_skipped: update.session_skipped,
    session_samples: sessionSamples,
    sample_size_mb: update.sample_size_mb ?? existing?.sample_size_mb ?? 0,
    sample_bases: update.sample_bases ?? existing?.sample_bases ?? 0,
    downloaded_mb: update.downloaded_mb ?? 0,
    updated_at: new Date().toISOString(),
  };

  progressMap.set(update.username, progress);
  return progress;
}

/**
 * Get the current pipeline progress for a user, or null if none recorded.
 */
export function getProgress(username: string): UserProgress | null {
  return progressMap.get(username) ?? null;
}
