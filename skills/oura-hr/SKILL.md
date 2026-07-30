---
name: oura-hr
description: Oura Ring client for pi (npm:pi-oura-hr) — OAuth, heart rate, readiness, and an optional fully-editable footer (red heart + BPM). Use when wiring Oura into pi, building a custom health extension on pi-oura-hr lib primitives, or debugging /oura commands.
---

# Oura → pi

Client library + optional footer. Config: `~/.pi/agent/oura.json` (mode 0600).

## Setup

1. Create an app at https://cloud.ouraring.com/oauth/applications with redirect `http://localhost`
2. `/oura-setup clientId=… clientSecret=… redirectUri=http://localhost`
3. `/oura-auth` → open URL → paste callback: `/oura-auth http://localhost/?code=…`
4. Optional footer: `/oura-setup footer.enabled=true` and add `external-status` key `oura-hr` to pi-footer (knownKeys + hiddenKeys)

## Editable footer (defaults = shipped look)

```text
/oura-setup footer.heart=❤ footer.heartColor=red
/oura-setup footer.showBpm=true footer.bpmColor=text footer.bpmStaleColor=muted
/oura-setup footer.showReadiness=true footer.readinessColor=text
/oura-setup footer.showAge=false footer.fields=heart,bpm,readiness
```

Colors: theme tokens, named ANSI (`red`), `ansi:31`, or raw ESC. Details: package `README.md`, lifecycle/structure: `ARCHITECTURE.md`.

## Commands

`/oura` · `/oura-refresh` · `/oura-auth` · `/oura-setup`

## Primitives

```ts
import { ensureAccessToken, fetchHealthSnapshot, renderFooterStatus, loadConfig } from "../lib/index.ts";
```

Footer is **opt-in** via `footer.enabled`.
