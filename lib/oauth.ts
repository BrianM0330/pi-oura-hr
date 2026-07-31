import { loadConfig, saveConfig } from "./config.js";
import { fetchJson } from "./http.js";
import {
  AUTHORIZE_URL,
  DEFAULT_REDIRECT,
  DEFAULT_SCOPES,
  TOKEN_URL,
} from "./paths.js";
import type { OuraConfig } from "./types.js";

export function buildAuthorizeUrl(cfg: OuraConfig, state?: string): string | null {
  if (!cfg.clientId) return null;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri || DEFAULT_REDIRECT,
    scope: cfg.scope || DEFAULT_SCOPES,
    state: state || `pi-oura-${Date.now()}`,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

type TokenBody = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

async function persistTokens(cfg: OuraConfig, body: TokenBody): Promise<OuraConfig> {
  if (!body.access_token) {
    throw new Error(body.error_description || body.error || "token response missing access_token");
  }
  const next: OuraConfig = {
    ...cfg,
    accessToken: body.access_token,
    // Oura refresh tokens are single-use — always persist the new one when present.
    refreshToken: body.refresh_token || cfg.refreshToken,
    expiresAt: Math.floor(Date.now() / 1000) + (body.expires_in ?? 86400) - 120,
    scope: body.scope || cfg.scope,
  };
  saveConfig(next);
  return next;
}

export async function exchangeCode(cfg: OuraConfig, code: string): Promise<OuraConfig> {
  if (!cfg.clientId || !cfg.clientSecret) {
    throw new Error("clientId and clientSecret required in pi-oura-hr.json");
  }
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: cfg.redirectUri || DEFAULT_REDIRECT,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });
  const res = await fetchJson<TokenBody>(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok || !res.body?.access_token) {
    throw new Error(
      res.body?.error_description ||
        res.body?.error ||
        res.text ||
        `token exchange failed (${res.status})`,
    );
  }
  return persistTokens(cfg, res.body);
}

export async function refreshAccessToken(cfg: OuraConfig): Promise<OuraConfig> {
  if (!cfg.clientId || !cfg.clientSecret || !cfg.refreshToken) {
    throw new Error("Missing clientId/clientSecret/refreshToken — run /oura-auth");
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: cfg.refreshToken,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });
  const res = await fetchJson<TokenBody>(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok || !res.body?.access_token) {
    throw new Error(
      res.body?.error_description ||
        res.body?.error ||
        res.text ||
        `refresh failed (${res.status})`,
    );
  }
  return persistTokens(cfg, res.body);
}

/** Return a config with a usable access token, refreshing if needed. */
export async function ensureAccessToken(cfg: OuraConfig = loadConfig()): Promise<OuraConfig> {
  const now = Math.floor(Date.now() / 1000);
  if (cfg.accessToken && cfg.expiresAt && cfg.expiresAt > now + 60) {
    return cfg;
  }
  if (cfg.refreshToken) {
    return refreshAccessToken(cfg);
  }
  if (cfg.accessToken) return cfg;
  throw new Error("Not authenticated. Run /oura-auth");
}
