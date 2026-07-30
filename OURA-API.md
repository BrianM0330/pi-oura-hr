# Oura API — field notes (v2)

Practical reference from a live integration (July 2026): auth, heart-rate granularity, sync behavior, webhooks, HealthKit, and response examples. Suitable as a starting point for publishing an integration guide.

**Official docs**

- API reference: https://cloud.ouraring.com/v2/docs  
- Auth: https://cloud.ouraring.com/docs/authentication  
- OpenAPI (observed): https://cloud.ouraring.com/v2/static/json/openapi-1.37.json  
- App registration: https://cloud.ouraring.com/oauth/applications  

**Base URL:** `https://api.ouraring.com`  
**Sandbox base:** `https://api.ouraring.com/v2/sandbox/usercollection/...`  
(Sandbox accepts any `Authorization: Bearer <string>` and returns synthetic data.)

---

## 1. Authentication

### What you get when you create an app

| Credential | Purpose |
|------------|---------|
| **Client ID** | Public app id |
| **Client Secret** | Server-side token exchange / refresh |

These are **not** enough to read a user’s data by themselves.

### What does *not* work

```http
POST /oauth/token
grant_type=client_credentials
```

→ `400 unsupported_grant_type`  
`grant_type` must be `authorization_code` or `refresh_token`.

Using the client secret (or id) as a Bearer token → `401` invalid token.

**Personal Access Tokens (PATs)** were deprecated (end of 2025) and are gone.

### OAuth2 authorization code flow

| Step | URL / action |
|------|----------------|
| Authorize | `GET https://cloud.ouraring.com/oauth/authorize` |
| Token | `POST https://api.ouraring.com/oauth/token` |
| API calls | `Authorization: Bearer <access_token>` |

**Authorize query params**

| Param | Value |
|-------|--------|
| `response_type` | `code` |
| `client_id` | your client id |
| `redirect_uri` | must **exactly** match a registered redirect |
| `scope` | space-separated scopes |
| `state` | CSRF nonce |

**Scopes (common)**

| Scope | Data |
|-------|------|
| `email` | Email |
| `personal` | Age, sex, height, weight |
| `daily` | Daily sleep / activity / readiness summaries |
| `heartrate` | Time-series HR (Gen 3+) |
| `workout` | Workouts |
| `tag` | Tags |
| `session` | Moments / sessions |
| `spo2Daily` | Daily SpO2 |

Registered apps are limited to **~10 users** until Oura approves the app.

### Redirect URIs (local dev)

- **No public domain required** for personal use.
- Register e.g. `http://localhost` (exact string).
- Port-specific URIs (`http://localhost:8765/callback`) only work if registered; otherwise authorize returns `400 invalid_request`.
- Binding privileged port 80 for automatic callback capture often needs root on macOS — easiest UX: user copies the failed `http://localhost/?code=...` URL from the address bar.

### Token exchange

```bash
curl -sS -X POST 'https://api.ouraring.com/oauth/token' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'grant_type=authorization_code' \
  -d 'code=AUTH_CODE' \
  -d 'redirect_uri=http://localhost' \
  -d 'client_id=CLIENT_ID' \
  -d 'client_secret=CLIENT_SECRET'
```

**Example success (shape)**

```json
{
  "token_type": "bearer",
  "access_token": "_0XBPWQQ_…",
  "expires_in": 2591999,
  "refresh_token": "_1XBPWQQ_…",
  "scope": "extapi:email extapi:personal extapi:daily extapi:heartrate …",
  "id_token": null
}
```

Notes:

- `expires_in` observed ~**30 days** (`2591999` s), not a short-lived hour token.
- **Refresh tokens are single-use.** Always store the new `refresh_token` from each refresh response.
- Scope strings in the token response are prefixed (`extapi:heartrate`); request scopes without that prefix.

### Refresh

```bash
curl -sS -X POST 'https://api.ouraring.com/oauth/token' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'grant_type=refresh_token' \
  -d 'refresh_token=REFRESH' \
  -d 'client_id=CLIENT_ID' \
  -d 'client_secret=CLIENT_SECRET'
```

### Callback URL shape (real)

```
http://localhost/?iss=https%3A%2F%2Fmoi.ouraring.com%2Foauth%2Fv2%2Fext%2Foauth-anonymous&code=…&state=…
```

Parse `code` from the query string; ignore `iss`.

---

## 2. Heart rate API

### Endpoint

```
GET /v2/usercollection/heartrate
```

**Scope:** `heartrate`  
**Docs summary:** time-series HR day and night at **5-minute increments** (official line). Real data can be denser (see below).

### Query parameters

| Param | Description |
|-------|-------------|
| `start_datetime` | ISO 8601 start |
| `end_datetime` | ISO 8601 end |
| `next_token` | Pagination |
| `latest` | `true` → most recent sample only |
| `fields` | Optional field filter |

Timezone `+` in query strings should be `%2B`.

### Response schema (`PublicHeartRateRow`)

```json
{
  "data": [
    {
      "timestamp": "2026-07-30T04:03:19.000Z",
      "timestamp_unix": 0,
      "bpm": 76,
      "source": "awake",
      "producer_timestamp": 1785362697437
    }
  ],
  "next_token": null
}
```

| Field | Notes |
|-------|--------|
| `timestamp` | Sample time (ISO) |
| `bpm` | Integer BPM |
| `source` | enum: `awake` \| `workout` \| `rest` \| `sleep` \| `live` \| `session` |
| `producer_timestamp` | Present in live responses; often shared across a batch (not always a clean wall-clock) |
| `next_token` | Opaque pagination; pages can be large (observed **1000** rows/page) |

### Example: latest sample

```bash
curl -sS 'https://api.ouraring.com/v2/usercollection/heartrate?latest=true' \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

```json
{
  "data": [
    {
      "timestamp": "2026-07-30T04:03:19.000Z",
      "bpm": 76,
      "producer_timestamp": 1785362697437,
      "source": "awake"
    }
  ],
  "next_token": null
}
```

### Observed interval reality (not just “every 5 min”)

From a real 8h window (~700+ samples):

| Interval | Meaning |
|----------|---------|
| **~5 s clusters** | Dense bursts (esp. workout / active awake) |
| **~300 s (5 min)** | Classic resting daytime cadence |
| Larger gaps | Movement / no valid sample / no sync |

Official product docs (Heart Rate Graph): daytime measurement is **one full minute every ~5 minutes** under good conditions; gaps up to **~30 minutes** possible with movement. Live HR is on-demand in the app.

### Sync vs sample interval

```
Ring measures  →  phone (BT)  →  Oura app  →  Oura cloud  →  API
```

| Layer | Cadence |
|-------|---------|
| Measurement | ~5 min daytime when conditions OK |
| Upload | Background *best effort*; can lag **hours** |
| API poll | Only as fresh as cloud |

Oura docs classify **Heart Rate**, **Daily Activity**, **Daily Stress** as background-sync types; **Sleep / Readiness** usually need the user to open the app.

**Empirical:** opening the app once did **not** always push new HR to the API immediately; later the same day HR resumed with hundreds of new points. Treat “open app” as helpful, not a guarantee of sub-minute cloud lag.

Webhooks fire ~**30 seconds after** mobile sync for supported types — they do **not** increase ring sample rate.

---

## 3. Related endpoints & granularity

| Endpoint | Granularity / contents |
|----------|-------------------------|
| `/v2/usercollection/sleep` | Night periods; `heart_rate` / `hrv` as `PublicSample` (`interval` seconds + `items[]`); `movement_30_sec`; `sleep_phase_30_sec` / `sleep_phase_5_min`; averages noted as 30s-engine vs app 5-min display |
| `/v2/usercollection/daily_sleep` | Daily sleep score + contributors |
| `/v2/usercollection/daily_readiness` | Daily readiness + contributors (incl. resting HR contributor) |
| `/v2/usercollection/daily_activity` | Steps, calories; `class_5_min` string; `met` sample series (often 1/min → 1440 items/day) |
| `/v2/usercollection/daily_stress` | Day summary; high stress/recovery seconds |
| `/v2/usercollection/daily_spo2` | Daily SpO2 average + BDI (not continuous SpO2 stream) |
| `/v2/usercollection/workout` | Workout summaries |
| `/v2/usercollection/session` | Moments; nested HR/HRV samples |
| `/v2/usercollection/personal_info` | Profile (needs `personal`) |
| `/v2/usercollection/ring_configuration` | Hardware (needs scope; may 403) |

**No public `interbeat_interval` / raw IBI route** in current OpenAPI paths.

### Sleep HR note (from OpenAPI descriptions)

- `average_heart_rate` / `lowest_heart_rate`: computed from **30-second** engine samples.  
- App UI averages **5-minute** aggregates — values can differ from API averages.

### `PublicSample`

```json
{
  "interval": 60.0,
  "items": [54.0, 73.0, 82.0],
  "timestamp": "2021-01-01T00:00:00.000+00:00"
}
```

`interval` = seconds between items.

---

## 4. Webhooks

```
POST/GET/PUT/DELETE /v2/webhook/subscription
```

Subscription management uses app credentials (`x-client-id` / `x-client-secret` style headers per docs) — **not** the user Bearer for CRUD on subscriptions (see current OpenAPI).

**Event types:** `create` | `update` | `delete`  
**Data types (`ExtApiV2DataType`):**

```
tag, enhanced_tag, workout, session, sleep, daily_sleep,
daily_readiness, daily_activity, daily_spo2, sleep_time,
rest_mode_period, ring_configuration, daily_stress,
daily_cardiovascular_age, daily_resilience, vo2_max, meal
```

**Not included:** `heartrate`, `personal_info`.

So for HR dashboards: poll `/heartrate`, or webhook on `daily_activity` / `daily_stress` as a weak “something synced” signal then fetch HR.

Payload is a notification; fetch full documents by id afterward. ~30s after app→cloud sync.

---

## 5. Rate limits

Two layers: per access token and per application. On `429`, honor:

- `Retry-After`
- `X-RateLimit-Limit`
- `X-RateLimit-Window`
- `X-RateLimit-Reset`
- `X-RateLimit-Tier`

Prefer webhooks + sparse polling over tight loops. A 5‑minute HR poll for a single user is negligible.

---

## 6. Apple Health / local alternatives

### Oura → Apple Health

Official integration exports **Heart Rate in one-minute intervals** when Oura data syncs.

Troubleshooting notes from Oura support:

- Open Oura (and Health) at least daily  
- Background App Refresh on  
- Low Power Mode can block sync  

HealthKit does **not** bypass ring→phone lag; it only changes the read path after Oura has written samples.

### HealthSync-style bridges

Projects like [mneves75/ai-health-sync-ios](https://github.com/mneves75/ai-health-sync-ios) expose HealthKit over a local TLS server to a Mac CLI. Good for **local experiments**, not a faster Oura uplink.

### Apple Watch

Separate sensor writing its own HR into HealthKit — usually denser daytime coverage. Oura does not stream live HR “to the Watch” as a special channel.

---

## 7. End-to-end checklist (personal integration)

1. Create app at cloud.ouraring.com → note Client ID/Secret.  
2. Register redirect `http://localhost` (or a high-port callback you control).  
3. Authorize with scopes including `heartrate`.  
4. Exchange code → store `access_token`, `refresh_token`, `expires_at`.  
5. On each cycle: refresh if near expiry → `GET .../heartrate?latest=true`.  
6. Display BPM + **sample age** (critical UX — cloud lag is real).  
7. Optional: webhook `daily_activity` for non-HR signals.  
8. For local-only Mac tooling: HealthKit bridge after Oura→Health is enabled.

---

## 8. Security notes

- Treat Client Secret + refresh token like passwords (`chmod 600` config files).  
- Never commit tokens.  
- Refresh tokens rotate — losing the latest refresh token forces full re-auth.  
- DEV-only credentials pasted in chat should be rotated if the log is shared.

---

## 9. This repo’s pi extension

See [README.md](./README.md). Config: `~/.pi/agent/oura.json`. Footer key: `oura-hr`. Poll default: 5 minutes. Commands: `/oura`, `/oura-refresh`, `/oura-auth`, `/oura-setup`.

---

## 10. Quick reference cURL kit

```bash
# Latest HR
curl -sS 'https://api.ouraring.com/v2/usercollection/heartrate?latest=true' \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq .

# Last 24h (paginate with next_token as needed)
curl -sS "https://api.ouraring.com/v2/usercollection/heartrate?\
start_datetime=2026-07-29T00:00:00Z&end_datetime=2026-07-30T00:00:00Z" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq '.data | length'

# Personal info smoke test
curl -sS 'https://api.ouraring.com/v2/usercollection/personal_info' \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq .

# Sandbox (no real user token)
curl -sS 'https://api.ouraring.com/v2/sandbox/usercollection/heartrate?\
start_datetime=2024-01-01T00:00:00Z&end_datetime=2024-01-02T00:00:00Z' \
  -H 'Authorization: Bearer sandbox' | jq .
```
