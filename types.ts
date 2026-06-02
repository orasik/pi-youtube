// ---------------------------------------------------------------------------
// Shared types for the YouTube extension
// ---------------------------------------------------------------------------

/** A single segment / caption line in the transcript */
export interface TranscriptSegment {
  text: string;
  /** Start time in seconds (can be string from API) */
  start: number;
  /** Duration in seconds (can be string from API) */
  dur: number;
}

/** One language track returned by the transcript API */
export interface TranscriptTrack {
  language: string;
  transcript: TranscriptSegment[];
}

/** The full transcript payload returned by youtube-transcript.io */
export interface TranscriptResult {
  id: string;
  title: string;
  tracks: TranscriptTrack[];
  /** Additional metadata (thumbnail, description, view count, etc.) */
  microformat?: Record<string, unknown>;
}

/** User-facing config persisted to config.json */
export interface YoutubeConfig {
  /** Directory where transcript .md files are saved */
  transcriptDir: string;
  /** Directory where summary .md files are saved */
  summaryDir: string;
}
