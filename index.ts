/**
 * pi-oura-hr — Pi extension entry.
 *
 * Library primitives live in `./lib` (importable without this UI).
 * Footer is opt-in and fully config-driven — see README + ARCHITECTURE.md.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
  DEFAULT_FOOTER,
  DEFAULT_POLL_MS,
  DEFAULT_STARTUP_DELAY_MS,
  DEFAULT_STATUS_KEY,
  MIN_POLL_MS,
  STALE_FAST_AFTER_MS,
  STALE_FAST_POLL_MS,
  buildAuthorizeUrl,
  ensureAccessToken,
  exchangeCode,
  fetchHealthSnapshot,
  fetchLatestHeartRate,
  footerEnabled,
  formatAge,
  getCachePath,
  getConfigPath,
  invalidateConfigCache,
  loadConfig,
  loadSampleCache,
  refreshAccessToken,
  renderFooterStatus,
  resolveFooter,
  sampleAgeMs,
  saveConfig,
  saveSampleCache,
  type DailyReadinessRow,
  type HeartRateSample,
  type OuraConfig,
  type OuraFooterConfig,
  type OuraFooterField,
} from "./lib/index.js";

const UI_TICK_MS = 60_000;

function unrefTimer(t: ReturnType<typeof setInterval> | ReturnType<typeof setTimeout>): void {
  if (typeof t === "object" && t && "unref" in t) {
    try {
      (t as NodeJS.Timeout).unref();
    } catch {
      /* ignore */
    }
  }
}

function paintStatus(
  ctx: ExtensionContext,
  sample: HeartRateSample | null,
  readinessScore: number | null,
  err: string | null,
  conf: OuraConfig,
): string {
  return renderFooterStatus({
    sample,
    readinessScore,
    err,
    footer: conf.footer,
    themeFg: (token, text) => ctx.ui.theme.fg(token as never, text),
  });
}

function parseBool(v: string | undefined): boolean | undefined {
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return undefined;
}

function applyFooterUpdates(
  footer: OuraFooterConfig,
  updates: Record<string, string>,
): boolean {
  let touched = false;
  const set = <K extends keyof OuraFooterConfig>(key: K, value: OuraFooterConfig[K]) => {
    footer[key] = value;
    touched = true;
  };

  const en = parseBool(updates["footer.enabled"]);
  if (en !== undefined) set("enabled", en);

  if (updates["footer.statusKey"]) set("statusKey", updates["footer.statusKey"]);
  if (updates["footer.heart"]) set("heart", updates["footer.heart"]);
  if (updates["footer.heartColor"]) set("heartColor", updates["footer.heartColor"]);

  const showBpm = parseBool(updates["footer.showBpm"]);
  if (showBpm !== undefined) set("showBpm", showBpm);
  if (updates["footer.bpmColor"]) set("bpmColor", updates["footer.bpmColor"]);
  if (updates["footer.bpmStaleColor"]) set("bpmStaleColor", updates["footer.bpmStaleColor"]);
  if (updates["footer.freshBpmMs"]) {
    const n = Number(updates["footer.freshBpmMs"]);
    if (Number.isFinite(n) && n >= 0) set("freshBpmMs", Math.floor(n));
  }

  const showReady = parseBool(updates["footer.showReadiness"]);
  if (showReady !== undefined) set("showReadiness", showReady);
  if (updates["footer.readinessColor"]) set("readinessColor", updates["footer.readinessColor"]);

  const showAge = parseBool(updates["footer.showAge"]);
  if (showAge !== undefined) set("showAge", showAge);
  if (updates["footer.ageColor"]) set("ageColor", updates["footer.ageColor"]);

  if (updates["footer.separator"] !== undefined) {
    // Allow empty via footer.separator=
    set("separator", updates["footer.separator"]);
  }
  if (updates["footer.fields"]) {
    const fields = updates["footer.fields"]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean) as OuraFooterField[];
    if (fields.length) set("fields", fields);
  }

  return touched;
}

export default function (pi: ExtensionAPI) {
  let ctxRef: ExtensionContext | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let uiTimer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;
  let lastSample: HeartRateSample | null = null;
  let lastReadinessScore: number | null = null;
  let lastReadinessDay: string | null = null;
  let lastError: string | null = null;
  let lastFetchAt = 0;
  let lastLatencyMs: number | null = null;
  let lastStatusText: string | undefined;
  let consecutiveFailures = 0;
  let nextAllowedPollAt = 0;

  function conf(): OuraConfig {
    return loadConfig();
  }

  function footer() {
    return resolveFooter(conf().footer);
  }

  function statusKey(): string {
    return footer().statusKey || DEFAULT_STATUS_KEY;
  }

  function basePollMs(): number {
    return Math.max(MIN_POLL_MS, conf().pollIntervalMs ?? DEFAULT_POLL_MS);
  }

  function startupDelayMs(): number {
    return Math.max(0, conf().startupDelayMs ?? DEFAULT_STARTUP_DELAY_MS);
  }

  function adaptivePollEnabled(): boolean {
    return conf().adaptivePoll === true;
  }

  function staleFastPollMs(): number {
    return Math.max(MIN_POLL_MS, conf().stalePollIntervalMs ?? STALE_FAST_POLL_MS);
  }

  function nextPollDelayMs(): number {
    const now = Date.now();
    if (now < nextAllowedPollAt) {
      return Math.max(MIN_POLL_MS, nextAllowedPollAt - now);
    }
    if (consecutiveFailures > 0) {
      return Math.min(
        BACKOFF_MAX_MS,
        BACKOFF_BASE_MS * 2 ** Math.min(consecutiveFailures - 1, 6),
      );
    }
    if (adaptivePollEnabled()) {
      const age = sampleAgeMs(lastSample);
      if (age != null && age >= STALE_FAST_AFTER_MS) return staleFastPollMs();
    }
    return basePollMs();
  }

  function clearPollTimer(): void {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function scheduleNextPoll(): void {
    clearPollTimer();
    pollTimer = setTimeout(() => {
      void poll("interval");
    }, nextPollDelayMs());
    unrefTimer(pollTimer);
  }

  function scheduleFirstPoll(): void {
    clearPollTimer();
    pollTimer = setTimeout(() => {
      void poll("startup");
    }, startupDelayMs());
    unrefTimer(pollTimer);
  }

  function publish(force = false): void {
    if (!footerEnabled(conf())) return;
    const ctx = ctxRef;
    if (!ctx?.hasUI) return;
    const text = paintStatus(ctx, lastSample, lastReadinessScore, lastError, conf());
    if (!force && text === lastStatusText) return;
    lastStatusText = text;
    ctx.ui.setStatus(statusKey(), text);
  }

  function clearFooter(): void {
    const ctx = ctxRef;
    if (!ctx?.hasUI) return;
    if (footerEnabled(conf())) {
      ctx.ui.setStatus(statusKey(), undefined);
    }
    lastStatusText = undefined;
  }

  function startUiTick(): void {
    if (!footerEnabled(conf())) return;
    if (uiTimer) return;
    uiTimer = setInterval(() => publish(false), UI_TICK_MS);
    unrefTimer(uiTimer);
  }

  function stopTimers(): void {
    clearPollTimer();
    if (uiTimer) {
      clearInterval(uiTimer);
      uiTimer = null;
    }
  }

  function applyReadiness(row: DailyReadinessRow | null): void {
    if (!row || row.score == null) return;
    lastReadinessScore = row.score;
    lastReadinessDay = row.day ?? null;
  }

  async function poll(reason: string): Promise<void> {
    if (inFlight) return;
    if (reason === "interval" && Date.now() < nextAllowedPollAt) {
      scheduleNextPoll();
      return;
    }
    inFlight = true;
    try {
      let c = conf();
      if (!c.clientId && !c.accessToken && !c.refreshToken) {
        lastError = "unconfigured";
        publish(true);
        return;
      }

      c = await ensureAccessToken(c);
      try {
        const snap = await fetchHealthSnapshot(c);
        if (snap.heartRate) lastSample = snap.heartRate;
        applyReadiness(snap.readiness);
        lastError = null;
        lastLatencyMs = snap.latencyMs;
        consecutiveFailures = 0;
        nextAllowedPollAt = 0;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const status = (err as { status?: number })?.status;
        const retryAfterMs = (err as { retryAfterMs?: number | null })?.retryAfterMs ?? null;

        if (/401|invalid|expired|unauthorized|token/i.test(msg) && c.refreshToken) {
          c = await refreshAccessToken(c);
          const hr = await fetchLatestHeartRate(c.accessToken!);
          lastSample = hr.sample;
          lastError = null;
          lastLatencyMs = hr.latencyMs;
          consecutiveFailures = 0;
          nextAllowedPollAt = 0;
        } else {
          consecutiveFailures += 1;
          if (status === 429 || retryAfterMs != null) {
            nextAllowedPollAt =
              Date.now() +
              (retryAfterMs ??
                Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.min(consecutiveFailures, 6)));
          }
          throw err;
        }
      }

      lastFetchAt = Date.now();
      saveSampleCache({
        sample: lastSample,
        readinessScore: lastReadinessScore,
        readinessDay: lastReadinessDay,
        fetchedAt: lastFetchAt,
      });
      publish(true);
      if (lastSample) startUiTick();
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      publish(true);
      if (ctxRef?.hasUI && reason === "manual") {
        ctxRef.ui.notify(`Oura: ${lastError}`, "error");
      }
    } finally {
      inFlight = false;
      if (reason !== "shutdown") scheduleNextPoll();
    }
  }

  // -- Commands ----------------------------------------------------------

  pi.registerCommand("oura", {
    description: "Show Oura status (tokens, last HR, readiness, footer config)",
    handler: async (_args, ctx) => {
      ctxRef = ctx;
      const c = conf();
      const f = footer();
      const age = sampleAgeMs(lastSample);
      const lines = [
        "Oura",
        `  config: ${getConfigPath()}`,
        `  footer.enabled: ${f.enabled}`,
        `  footer.statusKey: ${f.statusKey}`,
        `  footer.heart: ${f.heart}  heartColor: ${f.heartColor}`,
        `  footer.showBpm: ${f.showBpm}  bpmColor: ${f.bpmColor} / stale: ${f.bpmStaleColor}`,
        `  footer.freshBpmMs: ${f.freshBpmMs}`,
        `  footer.showReadiness: ${f.showReadiness}  readinessColor: ${f.readinessColor}`,
        `  footer.showAge: ${f.showAge}  fields: ${f.fields.join(",")}`,
        `  clientId: ${c.clientId ? c.clientId.slice(0, 8) + "…" : "(missing)"}`,
        `  accessToken: ${c.accessToken ? "yes" : "no"}`,
        `  refreshToken: ${c.refreshToken ? "yes" : "no"}`,
        `  expiresAt: ${
          c.expiresAt ? new Date(c.expiresAt * 1000).toISOString() : "(unknown)"
        }`,
        `  pollIntervalMs: ${c.pollIntervalMs ?? DEFAULT_POLL_MS}`,
        `  startupDelayMs: ${c.startupDelayMs ?? DEFAULT_STARTUP_DELAY_MS}`,
        `  adaptivePoll: ${c.adaptivePoll === true}`,
        `  nextPollDelayMs: ${nextPollDelayMs()}`,
        `  lastLatencyMs: ${lastLatencyMs ?? "(n/a)"}`,
        `  lastFetchAt: ${lastFetchAt ? new Date(lastFetchAt).toISOString() : "never"}`,
        `  cache: ${getCachePath()}`,
      ];
      if (lastError) lines.push(`  lastError: ${lastError}`);
      if (lastSample) {
        lines.push(
          `  hr: ${lastSample.bpm} bpm @ ${lastSample.timestamp} (${formatAge(age ?? 0)} ago, ${lastSample.source ?? "?"})`,
        );
      } else {
        lines.push("  hr: (none)");
      }
      if (lastReadinessScore != null) {
        lines.push(
          `  readiness: ${lastReadinessScore}${lastReadinessDay ? ` (${lastReadinessDay})` : ""}`,
        );
      } else {
        lines.push("  readiness: (none)");
      }
      if (f.enabled && ctx.hasUI) {
        lines.push(
          `  footer paint: ${paintStatus(ctx, lastSample, lastReadinessScore, lastError, c)}`,
        );
      }
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("oura-refresh", {
    description: "Force-poll Oura now",
    handler: async (_args, ctx) => {
      ctxRef = ctx;
      consecutiveFailures = 0;
      nextAllowedPollAt = 0;
      await poll("manual");
      if (!lastError && lastSample) {
        const age = formatAge(sampleAgeMs(lastSample) ?? 0);
        const lat = lastLatencyMs != null ? `, ${lastLatencyMs}ms` : "";
        const ready =
          lastReadinessScore != null ? `, readiness ${lastReadinessScore}` : "";
        ctx.ui.notify(
          `Oura: ${lastSample.bpm} bpm (${lastSample.source ?? "?"}, ${age} ago${lat}${ready})`,
          "success",
        );
      }
    },
  });

  pi.registerCommand("oura-auth", {
    description: "Oura OAuth: show authorize URL, or paste callback URL/code to exchange",
    handler: async (args, ctx) => {
      ctxRef = ctx;
      let c = conf();
      const raw = (args || "").trim();

      if (!raw) {
        if (!c.clientId) {
          ctx.ui.notify(
            "No clientId. Run: /oura-setup clientId=<id> clientSecret=<secret>",
            "error",
          );
          return;
        }
        const url = buildAuthorizeUrl(c);
        ctx.ui.notify(
          [
            "1. Open this URL in a browser logged into Oura:",
            url,
            "",
            "2. After Allow, the browser lands on http://localhost/?code=... (page may fail — that's OK).",
            "3. Paste the full callback URL here:",
            "   /oura-auth http://localhost/?code=...&state=...",
            "   or just: /oura-auth <code>",
          ].join("\n"),
          "info",
        );
        return;
      }

      let code = raw;
      try {
        if (raw.includes("://") || raw.startsWith("http") || raw.includes("code=")) {
          const u = new URL(raw.startsWith("http") ? raw : raw);
          code = u.searchParams.get("code") || raw;
        }
      } catch {
        const m = raw.match(/[?&]code=([^&]+)/);
        if (m) code = decodeURIComponent(m[1]!);
      }
      code = code.trim();
      if (!code) {
        ctx.ui.notify("Could not find OAuth code in input.", "error");
        return;
      }

      try {
        c = await exchangeCode(c, code);
        consecutiveFailures = 0;
        nextAllowedPollAt = 0;
        ctx.ui.notify("Oura tokens saved. Polling…", "success");
        await poll("manual");
        startUiTick();
      } catch (err) {
        ctx.ui.notify(`Oura auth failed: ${err instanceof Error ? err.message : err}`, "error");
      }
    },
  });

  pi.registerCommand("oura-setup", {
    description:
      "Configure Oura credentials, poll, and footer.* (icon/colors/signals). See /oura-setup for keys.",
    handler: async (args, ctx) => {
      ctxRef = ctx;
      const c = conf();
      const raw = (args || "").trim();
      if (!raw) {
        const d = DEFAULT_FOOTER;
        ctx.ui.notify(
          [
            "Usage:",
            "  /oura-setup clientId=UUID clientSecret=SECRET",
            "  /oura-setup footer.enabled=true",
            "  /oura-setup footer.heart=❤ footer.heartColor=red",
            "  /oura-setup footer.showBpm=true footer.bpmColor=text footer.bpmStaleColor=muted",
            "  /oura-setup footer.showReadiness=true footer.readinessColor=text",
            "  /oura-setup footer.showAge=false footer.fields=heart,bpm,readiness",
            "  /oura-setup footer.freshBpmMs=1800000",
            "  /oura-setup pollIntervalMs=300000 startupDelayMs=90000",
            "  /oura-setup fetch.readiness=true fetch.heartRate=true",
            "",
            `Config: ${getConfigPath()}`,
            `Defaults: heart=${d.heart} heartColor=${d.heartColor} fields=${d.fields.join(",")}`,
            `footer.enabled: ${footerEnabled(c)}`,
            `clientId set: ${Boolean(c.clientId)}`,
            `secret set: ${Boolean(c.clientSecret)}`,
            `tokens: access=${Boolean(c.accessToken)} refresh=${Boolean(c.refreshToken)}`,
          ].join("\n"),
          "info",
        );
        return;
      }

      const updates: Record<string, string> = {};
      for (const part of raw.split(/\s+/)) {
        const eq = part.indexOf("=");
        if (eq <= 0) continue;
        updates[part.slice(0, eq)] = part.slice(eq + 1);
      }

      if (updates.clientId) c.clientId = updates.clientId;
      if (updates.clientSecret) c.clientSecret = updates.clientSecret;
      if (updates.redirectUri) c.redirectUri = updates.redirectUri;
      if (updates.scope) c.scope = updates.scope.replace(/,/g, " ");
      if (updates.pollIntervalMs) {
        const n = Number(updates.pollIntervalMs);
        if (Number.isFinite(n) && n >= MIN_POLL_MS) c.pollIntervalMs = Math.floor(n);
      }
      if (updates.startupDelayMs) {
        const n = Number(updates.startupDelayMs);
        if (Number.isFinite(n) && n >= 0) c.startupDelayMs = Math.floor(n);
      }
      if (updates.stalePollIntervalMs) {
        const n = Number(updates.stalePollIntervalMs);
        if (Number.isFinite(n) && n >= MIN_POLL_MS) c.stalePollIntervalMs = Math.floor(n);
      }
      if (updates.staleAfterMinutes) {
        const n = Number(updates.staleAfterMinutes);
        if (Number.isFinite(n) && n > 0) c.staleAfterMinutes = Math.floor(n);
      }
      const adaptive = parseBool(updates.adaptivePoll);
      if (adaptive !== undefined) c.adaptivePoll = adaptive;

      const fetchCfg = { ...(c.fetch ?? {}) };
      let fetchTouched = false;
      const fr = parseBool(updates["fetch.readiness"]);
      if (fr !== undefined) {
        fetchCfg.readiness = fr;
        fetchTouched = true;
      }
      const fh = parseBool(updates["fetch.heartRate"]);
      if (fh !== undefined) {
        fetchCfg.heartRate = fh;
        fetchTouched = true;
      }
      if (fetchTouched) c.fetch = fetchCfg;

      const footerCfg = { ...(c.footer ?? {}) };
      if (applyFooterUpdates(footerCfg, updates)) c.footer = footerCfg;

      saveConfig(c);
      invalidateConfigCache();
      consecutiveFailures = 0;
      nextAllowedPollAt = 0;
      ctx.ui.notify(`Saved ${getConfigPath()}`, "success");

      if (!footerEnabled(c)) {
        clearFooter();
        stopTimers();
        scheduleNextPoll();
      }

      if (c.accessToken || c.refreshToken) {
        void poll("manual");
      } else {
        scheduleNextPoll();
      }
      if (lastSample && footerEnabled(c)) startUiTick();
    },
  });

  // -- Lifecycle ---------------------------------------------------------

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    ctxRef = ctx;
    lastStatusText = undefined;

    const cached = loadSampleCache();
    if (cached.sample) {
      lastSample = cached.sample;
      lastFetchAt = cached.fetchedAt ?? 0;
      lastError = null;
    }
    if (cached.readinessScore != null) {
      lastReadinessScore = cached.readinessScore;
      lastReadinessDay = cached.readinessDay ?? null;
    }

    if (footerEnabled(conf())) {
      publish(true);
      if (lastSample) startUiTick();
    }

    // Never await network here — pi awaits session_start before feeling ready.
    scheduleFirstPoll();
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    stopTimers();
    if (ctx.hasUI && footerEnabled(conf())) {
      ctx.ui.setStatus(statusKey(), undefined);
    }
    ctxRef = null;
    lastStatusText = undefined;
  });
}
