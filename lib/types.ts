/**
 * Shared Oura types and config shape.
 *
 * Config lives at ~/.pi/agent/pi-oura-hr.json (mode 0600) by default.
 * Footer is opt-in via `footer.enabled`. Every footer visual is editable;
 * omitted keys use the package defaults (red ❤, theme text/muted BPM, readiness on).
 */

/** Theme token (e.g. "text", "muted"), named ANSI ("red"), "ansi:31", or raw ESC sequence. */
export type OuraColor = string;

/** Ordered footer segments. Unknown names are ignored. */
export type OuraFooterField = "heart" | "bpm" | "readiness" | "age";

export interface OuraFooterConfig {
  /** When true, the pi extension paints `setStatus(statusKey, …)`. Default: false. */
  enabled?: boolean;
  /** pi-footer external-status key. Default: "pi-oura-hr". */
  statusKey?: string;

  /** Heart / icon glyph. Default: "❤". */
  heart?: string;
  /** Heart color. Default: "red". */
  heartColor?: OuraColor;

  /** Show BPM. Default: true. */
  showBpm?: boolean;
  /** BPM color when sample age ≤ freshBpmMs. Default: "text". */
  bpmColor?: OuraColor;
  /** BPM color when older than freshBpmMs. Default: "muted". */
  bpmStaleColor?: OuraColor;
  /** Fresh window for BPM color (ms). Default: 1800000 (30m). */
  freshBpmMs?: number;

  /** Show daily readiness score. Default: true. */
  showReadiness?: boolean;
  /** Readiness color. Default: "text". */
  readinessColor?: OuraColor;

  /** Show sample age suffix (e.g. "12m"). Default: false. */
  showAge?: boolean;
  /** Age color. Default: "muted". */
  ageColor?: OuraColor;

  /** Joiner between segments. Default: " ". */
  separator?: string;
  /**
   * Segment order. Default: ["heart","bpm","readiness"].
   * Include "age" only if you want it (or set showAge).
   */
  fields?: OuraFooterField[];
}

/** What the poller fetches each cycle. Omitted keys default to true. */
export interface OuraFetchConfig {
  heartRate?: boolean;
  readiness?: boolean;
}

export interface OuraConfig {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  accessToken?: string;
  refreshToken?: string;
  /** Unix seconds when accessToken should be treated as expired. */
  expiresAt?: number;
  scope?: string;
  pollIntervalMs?: number;
  /** Delay before the first network poll after session_start (ms). */
  startupDelayMs?: number;
  /** Minutes after sample timestamp before we mark the reading stale (legacy / status). */
  staleAfterMinutes?: number;
  /** Optional override for fast poll when sample is stale (ms). */
  stalePollIntervalMs?: number;
  /** If true, poll more often when the last sample is old. Default false. */
  adaptivePoll?: boolean;
  /** Toggle which endpoints each poll hits. */
  fetch?: OuraFetchConfig;
  /**
   * Optional footer integration. Omit or set `enabled: false` to use only
   * commands / library primitives (no `setStatus`).
   */
  footer?: OuraFooterConfig;
  updatedAt?: string;
}

export interface HeartRateSample {
  timestamp: string;
  bpm: number;
  source?: string;
  producer_timestamp?: number | null;
}

export interface HeartRateResponse {
  data?: HeartRateSample[];
  next_token?: string | null;
  detail?: string;
}

export interface DailyReadinessRow {
  day?: string;
  score?: number;
  id?: string;
  timestamp?: string;
  contributors?: Record<string, number | null>;
  temperature_deviation?: number | null;
  temperature_trend_deviation?: number | null;
}

export interface DailyReadinessResponse {
  data?: DailyReadinessRow[];
  detail?: string;
}

export interface DailyStressRow {
  day?: string;
  id?: string;
  day_summary?: string | null;
  stress_high?: number | null;
  recovery_high?: number | null;
}

export interface DailyActivityRow {
  day?: string;
  id?: string;
  score?: number | null;
  steps?: number | null;
  active_calories?: number | null;
  timestamp?: string;
  high_activity_time?: number | null;
  class_5_min?: string;
}

export interface WorkoutRow {
  id?: string;
  activity?: string;
  day?: string;
  intensity?: string;
  start_datetime?: string;
  end_datetime?: string;
  calories?: number | null;
  distance?: number | null;
  source?: string;
}

/** Disk cache for last good HR (+ readiness) so footers can paint without network. */
export interface SampleCache {
  sample: HeartRateSample | null;
  readinessScore?: number | null;
  readinessDay?: string | null;
  fetchedAt?: number;
}

export interface FetchResult<T> {
  ok: boolean;
  status: number;
  body: T | null;
  text: string;
  retryAfterMs: number | null;
}

export class OuraHttpError extends Error {
  status?: number;
  retryAfterMs?: number | null;

  constructor(message: string, status?: number, retryAfterMs?: number | null) {
    super(message);
    this.name = "OuraHttpError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}
