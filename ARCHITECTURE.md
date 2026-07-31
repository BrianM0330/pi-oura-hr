# Architecture & performance

How `pi-oura-hr` is put together, how polling relates to the Oura cloud sync, and how it hooks into pi’s lifecycle without blocking startup.

## Code structure

```
pi-oura-hr/               # repo / local folder / npm name
  index.ts              # Pi extension only: commands + optional footer painter
  lib/
    index.ts            # Public exports (import as "pi-oura-hr" or "./lib")
    types.ts            # Config + API types (footer.* fully editable)
    paths.ts            # URLs, default intervals, default status key
    config.ts           # ~/.pi/agent/pi-oura-hr.json load/save (mtime cache)
    cache.ts            # ~/.pi/agent/pi-oura-hr-cache.json (last paint)
    http.ts             # Tiny JSON fetch + timeout + Retry-After
    oauth.ts            # Authorize URL, code exchange, refresh
    api.ts              # heartrate / readiness / stress / activity / workout
    age.ts              # Sample age helpers
    footer.ts           # Defaults, resolveFooter, renderFooterStatus
  skills/pi-oura-hr/    # Agent skill (setup reminders)
  README.md             # Human/agent setup
  OURA-API.md           # Field notes on the Oura API
  ARCHITECTURE.md       # This file
  package.json          # exports + pi.extensions (name: pi-oura-hr)
```

**Split of concerns**

| Layer | Responsibility | Depends on pi? |
|-------|----------------|----------------|
| `lib/*` | OAuth, HTTP, config, cache, footer **string** render | No |
| `index.ts` | `/oura*` commands, timers, `setStatus`, theme.fg bridge | Yes |

Other extensions should import from `pi-oura-hr` / `pi-oura-hr/lib`, not copy OAuth logic. Skip the extension entry if you only want data.

## Pi lifecycle (why we never await network on start)

```
pi starts
  → load extensions (sync factory — keep this cheap)
  → session_start handlers  ← pi AWAITS these before UI feels ready
  → interactive prompt
  → later: agent_end / commands / timers
  → session_shutdown
```

Best practices this package follows:

1. **Sync factory** — `export default function (pi)` only registers commands/handlers.
2. **`session_start` is non-blocking** — paint from disk cache, then `setTimeout` for the first poll. Never `await fetch…` here.
3. **Timers start in `session_start`, clear in `session_shutdown`** — and `.unref()` so they don’t keep Node alive.
4. **Skip unchanged `setStatus`** — avoids footer churn.
5. **UI tick** (~60s) recolors BPM when it crosses the fresh/stale threshold **without** hitting the network.

## Syncing vs polling (two different clocks)

```
Ring sensors  →  phone / Oura app  →  Oura cloud  →  GET /heartrate?latest=true
     ↑                  ↑                  ↑                    ↑
  hardware          local sync          upload lag         our poller
```

- **Poll interval** (`pollIntervalMs`, default 5m) is how often *we* ask the cloud.
- **Sample interval** is how often Oura *records* HR (often ~5m when awake/conditions allow).
- **Sync lag** is how long between a sample and it appearing in the API (can be minutes to hours).

So a 5-minute poll does **not** guarantee a 5-minute-old reading. The footer uses **sample timestamp age** (not “time since last HTTP”) to tint BPM: theme `text` while age ≤ `footer.freshBpmMs` (default 30m), then `muted`.

## Poll / backoff flow

```
session_start
  → load pi-oura-hr-cache.json → setStatus (if footer.enabled)
  → wait startupDelayMs (default 90s)
  → poll:
       ensureAccessToken (refresh if needed)
       fetchHealthSnapshot (HR and/or readiness per config)
       save cache → publish footer
  → schedule next: pollIntervalMs
       or adaptive faster interval if adaptivePoll + sample old
       or exponential backoff after errors / 429
```

`/oura-refresh` bypasses the startup delay and runs a poll immediately.

## Editable footer (defaults = shipped look)

All visual knobs live under `footer` in `pi-oura-hr.json`. Omitting a key keeps the default.

| Key | Default | Meaning |
|-----|---------|---------|
| `enabled` | `false` | Opt-in `setStatus` |
| `statusKey` | `pi-oura-hr` | pi-footer external key |
| `heart` | `❤` | Icon glyph (any Nerd Font / unicode) |
| `heartColor` | `red` | Named ANSI, theme token, `ansi:N`, or raw ESC |
| `showBpm` | `true` | Include BPM |
| `bpmColor` | `text` | Fresh BPM |
| `bpmStaleColor` | `muted` | BPM when age > `freshBpmMs` |
| `freshBpmMs` | `1800000` | Fresh window (30m) |
| `showReadiness` | `true` | Include readiness score when present |
| `readinessColor` | `text` | Readiness color |
| `showAge` | `false` | Age suffix (e.g. `12m`) |
| `ageColor` | `muted` | Age color |
| `separator` | `" "` | Between segments |
| `fields` | `heart,bpm,readiness` | Order (`age` optional) |

Fetch toggles (separate from display):

| Key | Default | Meaning |
|-----|---------|---------|
| `fetch.heartRate` | `true` | Hit `/heartrate` |
| `fetch.readiness` | derived | Off if `false`; else on when footer wants readiness or footer is off |

Colors: theme tokens (`text`, `muted`, `dim`, …), named ANSI (`red`, `yellow`, …), `ansi:31`, or a literal `\x1b[…m` prefix.

## Wiring the footer slot (pi-footer)

The extension only calls `ctx.ui.setStatus(key, text)`. Layout is owned by **pi-footer**:

1. `external-status` widget with `externalStatusKey` = your `footer.statusKey`
2. `preserveTrimStyles: true` so ANSI / theme styles survive
3. Put the widget where you want it on the row (end is a common choice)
4. Add the key to `extensionStatusRow.knownKeys` **and** `hiddenKeys`

## Publishing checklist

- `package.json` `exports`: `.` / `./lib` → client; `./extension` → this entry
- `pi.extensions` / `pi.skills` for `pi install`
- No secrets in the repo — only `~/.pi/agent/pi-oura-hr.json` (0600)
- README is the setup path for humans and agents
