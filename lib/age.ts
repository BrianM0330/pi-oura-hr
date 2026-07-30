import type { HeartRateSample } from "./types.js";

export function parseSampleTime(ts: string): Date {
  return new Date(
    ts.endsWith("Z") || ts.includes("+") || ts.includes("-", 10) ? ts : ts + "Z",
  );
}

export function sampleAgeMs(sample: HeartRateSample | null): number | null {
  if (!sample) return null;
  return Date.now() - parseSampleTime(sample.timestamp).getTime();
}

export function formatAge(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hrs}h${rem}m` : `${hrs}h`;
}
