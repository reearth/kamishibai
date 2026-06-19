// kamishibai — incremental build bookkeeping.
// ------------------------------------------------------------------
// Two ways to render only what changed and reuse the rest:
//
//   --incremental  Compare each frame's fingerprint to the previous run's
//                  (stored in a manifest next to the PNGs). Unchanged frames
//                  keep their cached PNG; only changed frames are re-captured.
//
//   --only <spec>  Render just the frames you name (e.g. "0-30,90,120-150")
//                  and leave every other PNG untouched. A manual escape hatch
//                  for when you know exactly what you edited.
//
// Both reuse frames on disk, so both need a persisted --frames-dir. The
// manifest is invalidated whenever the output geometry changes (fps / size /
// scale), since old fingerprints no longer describe the same pixels.
// ------------------------------------------------------------------
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Bump when the manifest shape or fingerprint algorithm changes. */
export const MANIFEST_VERSION = 1;
/** Where the per-frame fingerprints live inside a frames dir. */
export const MANIFEST_FILE = ".kamishibai-cache.json";

/** The geometry that a set of fingerprints is only valid for. */
export interface ManifestKey {
  fps: number;
  width: number;
  height: number;
  scale: number;
}

export interface FrameManifest extends ManifestKey {
  version: number;
  /** frame index (as a string key) -> fingerprint */
  frames: Record<string, string>;
}

/** Build a manifest object from a fingerprint map and the run's geometry. */
export function buildManifest(key: ManifestKey, frames: Map<number, string>): FrameManifest {
  const out: Record<string, string> = {};
  for (const [i, fp] of frames) out[String(i)] = fp;
  return { version: MANIFEST_VERSION, ...key, frames: out };
}

/** True when a manifest's fingerprints still describe the requested geometry. */
export function manifestMatches(m: FrameManifest | undefined, key: ManifestKey): boolean {
  return (
    !!m &&
    m.version === MANIFEST_VERSION &&
    m.fps === key.fps &&
    m.width === key.width &&
    m.height === key.height &&
    m.scale === key.scale
  );
}

/** The previous run's fingerprints as a map, or empty if absent/incompatible. */
export function manifestFrames(m: FrameManifest | undefined, key: ManifestKey): Map<number, string> {
  const map = new Map<number, string>();
  if (!manifestMatches(m, key)) return map;
  for (const [k, v] of Object.entries(m!.frames)) map.set(Number(k), v);
  return map;
}

/**
 * Parse a frame-range spec like "0-30,90,120-150" into a set of frame indices,
 * clamped to [0, total). Whitespace is tolerated; an empty spec yields an empty
 * set. Throws on a malformed token so a typo never silently renders nothing.
 */
export function parseFrameRanges(spec: string, total: number): Set<number> {
  const out = new Set<number>();
  for (const raw of spec.split(",")) {
    const tok = raw.trim();
    if (!tok) continue;
    const m = /^(\d+)(?:-(\d+))?$/.exec(tok);
    if (!m) {
      throw new Error(`--only: bad range "${tok}" (use forms like 0-30,90,120-150)`);
    }
    const a = Number(m[1]);
    const b = m[2] != null ? Number(m[2]) : a;
    const lo = Math.max(0, Math.min(a, b));
    const hi = Math.min(total - 1, Math.max(a, b));
    for (let i = lo; i <= hi; i++) out.add(i);
  }
  return out;
}

/** Read a frames dir's manifest, or undefined if it's missing or unreadable. */
export async function readManifest(dir: string): Promise<FrameManifest | undefined> {
  try {
    const txt = await readFile(join(dir, MANIFEST_FILE), "utf8");
    const m = JSON.parse(txt) as FrameManifest;
    return m && typeof m === "object" && m.frames ? m : undefined;
  } catch {
    return undefined;
  }
}

/** Persist a manifest into a frames dir (overwrites any existing one). */
export async function writeManifest(dir: string, m: FrameManifest): Promise<void> {
  await writeFile(join(dir, MANIFEST_FILE), JSON.stringify(m));
}
