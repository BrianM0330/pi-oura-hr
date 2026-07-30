import { FETCH_TIMEOUT_MS } from "./paths.js";
import type { FetchResult } from "./types.js";

/** Tiny JSON fetch with timeout + Retry-After parsing. */
export async function fetchJson<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<FetchResult<T>> {
  const timeoutMs = init.timeoutMs ?? FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const { timeoutMs: _t, ...req } = init;
    const res = await fetch(url, { ...req, signal: controller.signal });
    const text = await res.text();
    let body: T | null = null;
    try {
      body = text ? (JSON.parse(text) as T) : null;
    } catch {
      body = null;
    }
    let retryAfterMs: number | null = null;
    const ra = res.headers.get("retry-after");
    if (ra) {
      const secs = Number(ra);
      if (Number.isFinite(secs)) retryAfterMs = Math.max(0, secs * 1000);
      else {
        const when = Date.parse(ra);
        if (Number.isFinite(when)) retryAfterMs = Math.max(0, when - Date.now());
      }
    }
    return { ok: res.ok, status: res.status, body, text, retryAfterMs };
  } finally {
    clearTimeout(timer);
  }
}
