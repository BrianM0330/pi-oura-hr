/**
 * Oura client primitives — usable from any pi extension or Node script.
 *
 *   import { ensureAccessToken, fetchLatestHeartRate, loadConfig } from "oura-hr";
 *
 * No pi UI dependency. Optional footer helpers are in `./footer.ts`.
 */

export type {
  OuraConfig,
  OuraFooterConfig,
  OuraFooterField,
  OuraFetchConfig,
  OuraColor,
  HeartRateSample,
  HeartRateResponse,
  DailyReadinessRow,
  DailyReadinessResponse,
  DailyStressRow,
  DailyActivityRow,
  WorkoutRow,
  SampleCache,
  FetchResult,
} from "./types.js";
export { OuraHttpError } from "./types.js";

export {
  DEFAULT_CONFIG_PATH,
  DEFAULT_CACHE_PATH,
  TOKEN_URL,
  AUTHORIZE_URL,
  API_BASE,
  DEFAULT_REDIRECT,
  DEFAULT_SCOPES,
  DEFAULT_POLL_MS,
  DEFAULT_STARTUP_DELAY_MS,
  MIN_POLL_MS,
  STALE_FAST_POLL_MS,
  STALE_FAST_AFTER_MS,
  DEFAULT_FRESH_BPM_MS,
  DEFAULT_STATUS_KEY,
  FETCH_TIMEOUT_MS,
  BACKOFF_MAX_MS,
  BACKOFF_BASE_MS,
} from "./paths.js";

export { fetchJson } from "./http.js";

export {
  setConfigPath,
  getConfigPath,
  loadConfig,
  saveConfig,
  invalidateConfigCache,
  footerEnabled,
  footerStatusKey,
  footerFreshBpmMs,
  shouldFetchReadiness,
  shouldFetchHeartRate,
} from "./config.js";

export {
  buildAuthorizeUrl,
  exchangeCode,
  refreshAccessToken,
  ensureAccessToken,
} from "./oauth.js";

export {
  fetchLatestHeartRate,
  fetchDailyReadiness,
  fetchDailyStress,
  fetchDailyActivity,
  fetchWorkouts,
  fetchHealthSnapshot,
} from "./api.js";
export type { HealthSnapshotOptions } from "./api.js";

export {
  setCachePath,
  getCachePath,
  loadSampleCache,
  saveSampleCache,
} from "./cache.js";

export { parseSampleTime, sampleAgeMs, formatAge } from "./age.js";

export {
  DEFAULT_FOOTER,
  resolveFooter,
  applyColor,
  renderFooterStatus,
} from "./footer.js";
export type { ResolvedFooter, ThemeFg } from "./footer.js";
