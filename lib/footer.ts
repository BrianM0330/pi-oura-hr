/**
 * Footer defaults + rendering (no pi import).
 *
 * Colors: theme token ("text", "muted"), named ANSI ("red"), "ansi:31",
 * or a raw ESC prefix. Pass theme.fg as `themeFg` from the extension.
 */

import { formatAge, sampleAgeMs } from "./age.js";
import {
  DEFAULT_FRESH_BPM_MS,
  DEFAULT_STATUS_KEY,
} from "./paths.js";
import type {
  HeartRateSample,
  OuraColor,
  OuraFooterConfig,
  OuraFooterField,
} from "./types.js";

const RESET = "\x1b[0m";

const NAMED_ANSI: Record<string, string> = {
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  brightWhite: "\x1b[97m",
  gray: "\x1b[90m",
  grey: "\x1b[90m",
  black: "\x1b[30m",
};

/** Package defaults — match the shipped glanceable look. */
export const DEFAULT_FOOTER: Required<
  Pick<
    OuraFooterConfig,
    | "enabled"
    | "statusKey"
    | "heart"
    | "heartColor"
    | "showBpm"
    | "bpmColor"
    | "bpmStaleColor"
    | "freshBpmMs"
    | "showReadiness"
    | "readinessColor"
    | "showAge"
    | "ageColor"
    | "separator"
    | "fields"
  >
> = {
  enabled: false,
  statusKey: DEFAULT_STATUS_KEY,
  heart: "❤",
  heartColor: "red",
  showBpm: true,
  bpmColor: "text",
  bpmStaleColor: "muted",
  freshBpmMs: DEFAULT_FRESH_BPM_MS,
  showReadiness: true,
  readinessColor: "text",
  showAge: false,
  ageColor: "muted",
  separator: " ",
  fields: ["heart", "bpm", "readiness"],
};

export type ResolvedFooter = typeof DEFAULT_FOOTER;

export function resolveFooter(partial?: OuraFooterConfig | null): ResolvedFooter {
  const f = partial ?? {};
  const fields =
    Array.isArray(f.fields) && f.fields.length > 0
      ? (f.fields.filter(Boolean) as OuraFooterField[])
      : [...DEFAULT_FOOTER.fields];

  // If showAge is on but "age" missing from fields, append it.
  if (f.showAge === true && !fields.includes("age")) fields.push("age");

  return {
    enabled: f.enabled === true,
    statusKey: f.statusKey || DEFAULT_FOOTER.statusKey,
    heart: f.heart ?? DEFAULT_FOOTER.heart,
    heartColor: f.heartColor ?? DEFAULT_FOOTER.heartColor,
    showBpm: f.showBpm !== false,
    bpmColor: f.bpmColor ?? DEFAULT_FOOTER.bpmColor,
    bpmStaleColor: f.bpmStaleColor ?? DEFAULT_FOOTER.bpmStaleColor,
    freshBpmMs:
      typeof f.freshBpmMs === "number" && Number.isFinite(f.freshBpmMs) && f.freshBpmMs >= 0
        ? f.freshBpmMs
        : DEFAULT_FOOTER.freshBpmMs,
    showReadiness: f.showReadiness !== false,
    readinessColor: f.readinessColor ?? DEFAULT_FOOTER.readinessColor,
    showAge: f.showAge === true,
    ageColor: f.ageColor ?? DEFAULT_FOOTER.ageColor,
    separator: f.separator ?? DEFAULT_FOOTER.separator,
    fields,
  };
}

export type ThemeFg = (token: string, text: string) => string;

export function applyColor(
  color: OuraColor,
  text: string,
  themeFg?: ThemeFg,
): string {
  if (!color || color === "none" || color === "default") return text;
  if (color.startsWith("\x1b")) return `${color}${text}${RESET}`;
  if (color.startsWith("ansi:")) {
    return `\x1b[${color.slice(5)}m${text}${RESET}`;
  }
  const named = NAMED_ANSI[color];
  if (named) return `${named}${text}${RESET}`;
  if (themeFg) {
    try {
      return themeFg(color, text);
    } catch {
      return text;
    }
  }
  return text;
}

export function renderFooterStatus(opts: {
  sample: HeartRateSample | null;
  readinessScore: number | null;
  err: string | null;
  footer?: OuraFooterConfig | null;
  themeFg?: ThemeFg;
}): string {
  const f = resolveFooter(opts.footer);
  const paint = (c: OuraColor, t: string) => applyColor(c, t, opts.themeFg);
  const heart = paint(f.heartColor, f.heart);

  if (opts.err && !opts.sample) {
    return `${heart}${f.separator}${paint("muted", "!")}`;
  }
  if (!opts.sample) {
    return `${heart}${f.separator}${paint("muted", "—")}`;
  }

  const ageMs = sampleAgeMs(opts.sample) ?? 0;
  const segments: string[] = [];

  for (const field of f.fields) {
    if (field === "heart") {
      segments.push(heart);
      continue;
    }
    if (field === "bpm") {
      if (!f.showBpm) continue;
      const bpm = String(Math.round(opts.sample.bpm));
      const color = ageMs <= f.freshBpmMs ? f.bpmColor : f.bpmStaleColor;
      segments.push(paint(color, bpm));
      continue;
    }
    if (field === "readiness") {
      if (!f.showReadiness) continue;
      if (opts.readinessScore == null || !Number.isFinite(opts.readinessScore)) continue;
      segments.push(paint(f.readinessColor, String(Math.round(opts.readinessScore))));
      continue;
    }
    if (field === "age") {
      if (!f.showAge) continue;
      segments.push(paint(f.ageColor, formatAge(ageMs)));
    }
  }

  return segments.join(f.separator);
}
