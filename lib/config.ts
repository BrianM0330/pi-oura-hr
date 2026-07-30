import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  chmodSync,
  statSync,
} from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_CONFIG_PATH } from "./paths.js";
import type { OuraConfig } from "./types.js";

let cachedConfig: OuraConfig | null = null;
let cachedConfigMtimeMs = -1;
let activeConfigPath = DEFAULT_CONFIG_PATH;

/** Override config path (tests / alternate installs). */
export function setConfigPath(path: string): void {
  activeConfigPath = path;
  invalidateConfigCache();
}

export function getConfigPath(): string {
  return activeConfigPath;
}

export function loadConfig(): OuraConfig {
  try {
    if (!existsSync(activeConfigPath)) {
      cachedConfig = {};
      cachedConfigMtimeMs = -1;
      return cachedConfig;
    }
    const mtimeMs = statSync(activeConfigPath).mtimeMs;
    if (cachedConfig && cachedConfigMtimeMs === mtimeMs) {
      return cachedConfig;
    }
    cachedConfig = JSON.parse(readFileSync(activeConfigPath, "utf8")) as OuraConfig;
    cachedConfigMtimeMs = mtimeMs;
    return cachedConfig;
  } catch {
    cachedConfig = {};
    cachedConfigMtimeMs = -1;
    return cachedConfig;
  }
}

export function saveConfig(cfg: OuraConfig): void {
  mkdirSync(dirname(activeConfigPath), { recursive: true });
  const next: OuraConfig = { ...cfg, updatedAt: new Date().toISOString() };
  writeFileSync(activeConfigPath, JSON.stringify(next, null, 2) + "\n", "utf8");
  try {
    chmodSync(activeConfigPath, 0o600);
  } catch {
    /* ignore */
  }
  cachedConfig = next;
  try {
    cachedConfigMtimeMs = statSync(activeConfigPath).mtimeMs;
  } catch {
    cachedConfigMtimeMs = Date.now();
  }
}

export function invalidateConfigCache(): void {
  cachedConfig = null;
  cachedConfigMtimeMs = -1;
}

export function footerEnabled(cfg: OuraConfig = loadConfig()): boolean {
  return cfg.footer?.enabled === true;
}

export function footerStatusKey(cfg: OuraConfig = loadConfig()): string {
  return cfg.footer?.statusKey || "oura-hr";
}

export function footerFreshBpmMs(cfg: OuraConfig = loadConfig()): number {
  const n = cfg.footer?.freshBpmMs;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : 30 * 60_000;
}

/** Whether the poller should hit daily_readiness (footer or explicit fetch flag). */
export function shouldFetchReadiness(cfg: OuraConfig = loadConfig()): boolean {
  if (cfg.fetch?.readiness === false) return false;
  if (cfg.fetch?.readiness === true) return true;
  // Default: fetch when footer wants it, or when footer is off (commands still useful).
  if (cfg.footer?.enabled === true) return cfg.footer.showReadiness !== false;
  return true;
}

export function shouldFetchHeartRate(cfg: OuraConfig = loadConfig()): boolean {
  return cfg.fetch?.heartRate !== false;
}
