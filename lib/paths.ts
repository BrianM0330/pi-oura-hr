import { homedir } from "node:os";
import { join } from "node:path";

/** Default secrets + tokens file (chmod 0600). */
export const DEFAULT_CONFIG_PATH = join(homedir(), ".pi", "agent", "oura.json");

/** Last good HR/readiness paint cache (chmod 0600). */
export const DEFAULT_CACHE_PATH = join(homedir(), ".pi", "agent", "oura-hr-cache.json");

export const TOKEN_URL = "https://api.ouraring.com/oauth/token";
export const AUTHORIZE_URL = "https://cloud.ouraring.com/oauth/authorize";
export const API_BASE = "https://api.ouraring.com/v2/usercollection";

export const DEFAULT_REDIRECT = "http://localhost";
export const DEFAULT_SCOPES = [
  "email",
  "personal",
  "daily",
  "heartrate",
  "workout",
  "tag",
  "session",
  "spo2Daily",
].join(" ");

export const DEFAULT_POLL_MS = 5 * 60 * 1000;
export const DEFAULT_STARTUP_DELAY_MS = 90_000;
export const MIN_POLL_MS = 30_000;
export const STALE_FAST_POLL_MS = 2 * 60_000;
export const STALE_FAST_AFTER_MS = 45 * 60_000;
export const DEFAULT_FRESH_BPM_MS = 30 * 60_000;
export const DEFAULT_STATUS_KEY = "oura-hr";
export const FETCH_TIMEOUT_MS = 10_000;
export const BACKOFF_MAX_MS = 30 * 60_000;
export const BACKOFF_BASE_MS = 60_000;
