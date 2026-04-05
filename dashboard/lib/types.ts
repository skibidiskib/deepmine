export interface User {
  id: string;
  username: string;
  display_name: string;
  github_url: string;
  institution: string;
  total_runs: number;
  total_bgcs: number;
  total_novel: number;
  best_score: number;
  first_seen: string;
  last_active: string;
}

export interface Run {
  id: string;
  user_id: string;
  run_id: string;
  samples_processed: number;
  bgcs_found: number;
  novel_count: number;
  top_score: number;
  config_summary: string;
  started_at: string;
  completed_at: string;
  duration_seconds: number;
}

export interface Discovery {
  id: string;
  run_id: string;
  user_id: string;
  bgc_id: string;
  source_sample: string;
  bgc_type: string;
  predicted_product: string;
  novelty_distance: number;
  activity_score: number;
  confidence: number;
  bgc_length_bp: number;
  gene_count: number;
  detector_tools: string[];
  discovered_at: string;
}

export interface SampleMetadata {
  id: string;
  sra_accession: string;
  environment_type: string;
  location_name: string;
  latitude: number;
  longitude: number;
  collection_date: string;
  organism: string;
}

export interface GlobalStats {
  total_bgcs: number;
  total_novel: number;
  total_users: number;
  total_environments: number;
  avg_score: number;
  top_score: number;
  total_runs: number;
}

export interface SubmitPayload {
  username: string;
  display_name?: string;
  institution?: string;
  github_url?: string;
  run_id: string;
  config?: string;
  samples: SampleInput[];
  candidates: CandidateInput[];
}

export interface SampleInput {
  sra_accession: string;
  environment?: string;
  location?: string;
  lat?: number;
  lon?: number;
}

export interface CandidateInput {
  bgc_id: string;
  source_sample: string;
  bgc_type: string;
  predicted_product?: string;
  novelty_distance: number;
  activity_score: number;
  confidence: number;
}

export interface TimelineEntry {
  date: string;
  bgcs_found: number;
  novel_found: number;
  cumulative_bgcs: number;
  cumulative_novel: number;
}

export type LeaderboardEntry = User;

export interface SSEEvent {
  type: 'new_discovery' | 'new_run' | 'heartbeat';
  data: any;
}
