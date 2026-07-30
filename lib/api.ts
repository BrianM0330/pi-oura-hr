import { ensureAccessToken } from "./oauth.js";
import { fetchJson } from "./http.js";
import { API_BASE } from "./paths.js";
import { loadConfig, shouldFetchHeartRate, shouldFetchReadiness } from "./config.js";
import {
  OuraHttpError,
  type DailyActivityRow,
  type DailyReadinessResponse,
  type DailyReadinessRow,
  type DailyStressRow,
  type HeartRateResponse,
  type HeartRateSample,
  type OuraConfig,
  type WorkoutRow,
} from "./types.js";

function authHeader(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

function throwIfFailed(
  res: { ok: boolean; status: number; body: unknown; text: string; retryAfterMs: number | null },
): void {
  if (res.ok) return;
  const detail =
    (res.body &&
      typeof res.body === "object" &&
      "detail" in res.body &&
      (res.body as { detail?: string }).detail) ||
    res.text ||
    `HTTP ${res.status}`;
  throw new OuraHttpError(String(detail), res.status, res.retryAfterMs);
}

export async function fetchLatestHeartRate(accessToken: string): Promise<{
  sample: HeartRateSample | null;
  status: number;
  retryAfterMs: number | null;
  latencyMs: number;
}> {
  const started = Date.now();
  const url = `${API_BASE}/heartrate?latest=true&fields=timestamp,bpm,source`;
  const res = await fetchJson<HeartRateResponse>(url, {
    headers: authHeader(accessToken),
  });
  const latencyMs = Date.now() - started;
  throwIfFailed(res);
  return {
    sample: res.body?.data?.[0] ?? null,
    status: res.status,
    retryAfterMs: res.retryAfterMs,
    latencyMs,
  };
}

/** Latest daily readiness row in [startDate, endDate] (ISO dates). */
export async function fetchDailyReadiness(
  accessToken: string,
  startDate: string,
  endDate: string,
): Promise<DailyReadinessRow | null> {
  const url = `${API_BASE}/daily_readiness?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`;
  const res = await fetchJson<DailyReadinessResponse>(url, {
    headers: authHeader(accessToken),
  });
  throwIfFailed(res);
  const rows = res.body?.data ?? [];
  return rows.length ? rows[rows.length - 1]! : null;
}

export async function fetchDailyStress(
  accessToken: string,
  startDate: string,
  endDate: string,
): Promise<DailyStressRow | null> {
  const url = `${API_BASE}/daily_stress?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`;
  const res = await fetchJson<{ data?: DailyStressRow[] }>(url, {
    headers: authHeader(accessToken),
  });
  throwIfFailed(res);
  const rows = res.body?.data ?? [];
  return rows.length ? rows[rows.length - 1]! : null;
}

export async function fetchDailyActivity(
  accessToken: string,
  startDate: string,
  endDate: string,
): Promise<DailyActivityRow | null> {
  const url = `${API_BASE}/daily_activity?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`;
  const res = await fetchJson<{ data?: DailyActivityRow[] }>(url, {
    headers: authHeader(accessToken),
  });
  throwIfFailed(res);
  const rows = res.body?.data ?? [];
  return rows.length ? rows[rows.length - 1]! : null;
}

export async function fetchWorkouts(
  accessToken: string,
  startDate: string,
  endDate: string,
): Promise<WorkoutRow[]> {
  const url = `${API_BASE}/workout?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`;
  const res = await fetchJson<{ data?: WorkoutRow[] }>(url, {
    headers: authHeader(accessToken),
  });
  throwIfFailed(res);
  return res.body?.data ?? [];
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export type HealthSnapshotOptions = {
  /** Override fetch.heartRate. */
  heartRate?: boolean;
  /** Override fetch.readiness / footer.showReadiness. */
  readiness?: boolean;
};

/** Convenience: ensure auth, then pull latest HR (+ readiness when enabled). */
export async function fetchHealthSnapshot(
  cfg?: OuraConfig,
  options?: HealthSnapshotOptions,
): Promise<{
  cfg: OuraConfig;
  heartRate: HeartRateSample | null;
  readiness: DailyReadinessRow | null;
  latencyMs: number;
}> {
  const base = cfg ?? loadConfig();
  const authed = await ensureAccessToken(base);
  const wantHr = options?.heartRate ?? shouldFetchHeartRate(authed);
  const wantReady = options?.readiness ?? shouldFetchReadiness(authed);

  const end = new Date();
  const start = new Date(end.getTime() - 3 * 24 * 60 * 60 * 1000);
  const startDate = isoDay(start);
  const endDate = isoDay(new Date(end.getTime() + 24 * 60 * 60 * 1000));

  let heartRate: HeartRateSample | null = null;
  let latencyMs = 0;
  if (wantHr) {
    const hr = await fetchLatestHeartRate(authed.accessToken!);
    heartRate = hr.sample;
    latencyMs = hr.latencyMs;
  }

  let readiness: DailyReadinessRow | null = null;
  if (wantReady) {
    try {
      readiness = await fetchDailyReadiness(authed.accessToken!, startDate, endDate);
    } catch {
      readiness = null;
    }
  }

  return {
    cfg: authed,
    heartRate,
    readiness,
    latencyMs,
  };
}
