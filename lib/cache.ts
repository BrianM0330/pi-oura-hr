import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  chmodSync,
} from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_CACHE_PATH } from "./paths.js";
import type { SampleCache } from "./types.js";

let activeCachePath = DEFAULT_CACHE_PATH;

export function setCachePath(path: string): void {
  activeCachePath = path;
}

export function getCachePath(): string {
  return activeCachePath;
}

export function loadSampleCache(): SampleCache {
  try {
    if (!existsSync(activeCachePath)) return { sample: null };
    return JSON.parse(readFileSync(activeCachePath, "utf8")) as SampleCache;
  } catch {
    return { sample: null };
  }
}

export function saveSampleCache(cache: SampleCache): void {
  try {
    mkdirSync(dirname(activeCachePath), { recursive: true });
    writeFileSync(activeCachePath, JSON.stringify(cache, null, 2) + "\n", "utf8");
    try {
      chmodSync(activeCachePath, 0o600);
    } catch {
      /* ignore */
    }
  } catch {
    /* ignore cache write failures */
  }
}
