# pi-oura-hr

**Built completely with my grok 4.5 clanker**

Oura Ring for pi: a small **client library** plus an **optional, fully editable** footer.

Use the library alone if you want your own commands/UI. Turn on the footer only when you want a glanceable heart + BPM (+ readiness).

## Quick start

### 1. Install

```bash
pi install npm:pi-oura-hr
# or: pi install git:BrianM0330/pi-oura-hr
```

Local symlink (dev):

```bash
ln -sfn /path/to/pi-oura-hr ~/.pi/agent/extensions/pi-oura-hr
```

### 2. Create an Oura app

1. Open [Oura API applications](https://cloud.ouraring.com/oauth/applications)
2. Create an app with redirect URI **`http://localhost`** (exact match)
3. Copy **Client ID** and **Client Secret**

Oura does not support `client_credentials`. Personal access tokens are deprecated.

### 3. Save credentials + authorize

```text
/oura-setup clientId=YOUR_ID clientSecret=YOUR_SECRET redirectUri=http://localhost
/oura-auth
```

Open the printed URL → Allow → copy the address bar (`http://localhost/?code=…`) even if the page fails to load:

```text
/oura-auth http://localhost/?code=…&state=…
```

Tokens land in `~/.pi/agent/pi-oura-hr.json` (mode `0600`). Refresh tokens are **single-use**; the client always persists the replacement.

### 4. (Optional) Footer

Footer is **off by default**. Enable it:

```text
/oura-setup footer.enabled=true
```

Then wire **pi-footer** once (if you use that package):

1. Add an `external-status` widget with `"externalStatusKey": "pi-oura-hr"` and `"preserveTrimStyles": true`
2. Put that widget where you want it on the row (end of the line is a good default)
3. Add `"pi-oura-hr"` to both `extensionStatusRow.knownKeys` and `hiddenKeys`

`/reload` (or restart pi).

**Default look** (all overridable): red `❤`; BPM uses theme `text` when the sample is ≤30 minutes old, theme `muted` when older; readiness score beside it; no age text.

## Editable footer

Every visual is a config key. Defaults match the shipped look. Set via JSON or `/oura-setup`:

```json
{
  "footer": {
    "enabled": true,
    "statusKey": "pi-oura-hr",
    "heart": "❤",
    "heartColor": "red",
    "showBpm": true,
    "bpmColor": "text",
    "bpmStaleColor": "muted",
    "freshBpmMs": 1800000,
    "showReadiness": true,
    "readinessColor": "text",
    "showAge": false,
    "ageColor": "muted",
    "separator": " ",
    "fields": ["heart", "bpm", "readiness"]
  }
}
```

Examples:

```text
/oura-setup footer.heart= footer.heartColor=red
/oura-setup footer.showReadiness=false
/oura-setup footer.showAge=true footer.fields=heart,bpm,age,readiness
/oura-setup footer.bpmColor=text footer.bpmStaleColor=dim footer.freshBpmMs=900000
```

**Colors** accept: theme tokens (`text`, `muted`, `dim`, …), named ANSI (`red`, `yellow`, …), `ansi:31`, or a raw ESC prefix.

**Fetch toggles** (what each poll hits):

```text
/oura-setup fetch.heartRate=true fetch.readiness=true
```

If `fetch.readiness` is omitted, readiness is fetched when the footer wants it (or whenever the footer is off, so `/oura` still has data).

## Commands

| Command | Purpose |
|---------|---------|
| `/oura` | Status (tokens, last HR, readiness, resolved footer knobs) |
| `/oura-refresh` | Poll now |
| `/oura-auth` | Authorize URL or exchange code |
| `/oura-setup …` | Credentials, poll, `footer.*`, `fetch.*` |

## Config knobs (non-footer)

File: `~/.pi/agent/pi-oura-hr.json`

| Field | Default | Notes |
|-------|---------|--------|
| `clientId` / `clientSecret` | — | From Oura developer portal |
| `redirectUri` | `http://localhost` | Must match the app |
| `pollIntervalMs` | `300000` | Steady poll cadence (floor 30s) |
| `startupDelayMs` | `90000` | First network poll after session start |
| `adaptivePoll` | `false` | Faster poll when sample is old |
| `fetch.heartRate` | `true` | Hit `/heartrate` |
| `fetch.readiness` | derived | See above |

## Build your own extension

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  fetchHealthSnapshot,
  loadConfig,
  renderFooterStatus,
} from "pi-oura-hr"; // or "./lib/index.ts"

export default function (pi: ExtensionAPI) {
  pi.registerCommand("my-oura", {
    description: "Custom Oura snapshot",
    handler: async (_args, ctx) => {
      const snap = await fetchHealthSnapshot(loadConfig());
      ctx.ui.notify(
        renderFooterStatus({
          sample: snap.heartRate,
          readinessScore: snap.readiness?.score ?? null,
          err: null,
          themeFg: (t, s) => ctx.ui.theme.fg(t as never, s),
        }),
        "info",
      );
    },
  });
}
```

| Import | What you get |
|--------|----------------|
| `pi-oura-hr` or `pi-oura-hr/lib` | Client + footer render helpers |
| `pi-oura-hr/extension` | This pi extension entry |

## Performance & structure

See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for:

- Package layout (`lib/` vs extension)
- Pi lifecycle (`session_start` never awaits network)
- Ring sync vs our poll clock
- Backoff / cache / UI tick

## Freshness

A 5-minute poll does **not** mean the ring samples every 5 minutes. The API returns the latest sample **already in Oura cloud**. See [OURA-API.md](./OURA-API.md).
