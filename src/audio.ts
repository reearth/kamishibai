// Audio is a declaration, not a generation step.
// ------------------------------------------------------------------
// kamishibai never makes sound. You hand it files + start times (from a
// TTS, a music track, whatever), and they get muxed at assembly time.
// ------------------------------------------------------------------

export interface AudioClip {
  /** path to an audio file, or a video file whose audio track to use
   *  (relative to the render's working dir, or absolute) */
  src: string;
  /** when this clip starts, in milliseconds from the reel start */
  atMs: number;
  /** volume adjustment in decibels (negative = quieter); default 0 */
  gain?: number;
  /** start offset into the source file, in ms (trim the head) */
  trimStartMs?: number;
  /** how much of the source to use, in ms (trim the tail) */
  durationMs?: number;
  /** linear fade-in over this many ms from the clip's start */
  fadeInMs?: number;
  /**
   * linear fade-out over this many ms at the clip's end. Needs a known end:
   * an explicit `durationMs`, or — for a `loop` clip — the reel length (so a
   * looped BGM fades out as the video ends).
   */
  fadeOutMs?: number;
  /**
   * Tile the source to fill from `atMs` to the reel end (or to `durationMs` if
   * set). For background music shorter than the video — no manual tiling. The
   * reel is the master timeline, so the loop is clamped to the video length.
   */
  loop?: boolean;
  /**
   * Auto-duck this clip under the others: kamishibai knows every clip's start
   * and length, so it derives `gainKeyframes` that dip this clip while any
   * non-ducked clip (e.g. narration) is playing, ramping back up in the gaps.
   * `true` uses sensible defaults; pass options to tune. Ignored if explicit
   * `gainKeyframes` are set. Combined with `gain` (the dip is on top of it).
   */
  duck?: boolean | DuckOptions;
  /**
   * Volume automation: dB keyframes over the clip's own timeline (atMs from
   * the clip start). The level is linearly interpolated in dB between them
   * and held flat outside the range — for ducking, swells, custom fades.
   * Combined additively with `gain` if both are set.
   */
  gainKeyframes?: Array<{ atMs: number; gain: number }>;
}

export type AudioManifest = AudioClip[];

/** Identity helper for authoring a manifest with types. */
export function audio(clips: AudioManifest): AudioManifest {
  return clips;
}

/** How an auto-ducked clip dips under the others. */
export interface DuckOptions {
  /** how far to dip while another clip plays, in dB (negative); default -12 */
  amountDb?: number;
  /** ramp-down to the dip, ending as the other clip starts, in ms; default 250 */
  attackMs?: number;
  /** ramp back up after the other clip ends, in ms; default 600 */
  releaseMs?: number;
}

const DUCK_DEFAULTS: Required<DuckOptions> = { amountDb: -12, attackMs: 250, releaseMs: 600 };

/** Merge time windows, bridging gaps shorter than `bridgeMs` (so the dip holds
 *  through short pauses instead of pumping back up between sentences). */
function mergeWindows(wins: Array<[number, number]>, bridgeMs: number): Array<[number, number]> {
  const sorted = wins.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s - last[1] <= bridgeMs) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/**
 * Turn a ducked clip's options + the windows it must dip under into dB
 * keyframes (relative to the clip's own start): 0 outside a window, `amountDb`
 * inside, with `attackMs`/`releaseMs` ramps. Pure; exported for testing.
 */
export function duckKeyframes(
  windows: Array<[number, number]>,
  clipAtMs: number,
  opts: DuckOptions = {},
): Array<{ atMs: number; gain: number }> {
  const { amountDb, attackMs, releaseMs } = { ...DUCK_DEFAULTS, ...opts };
  const merged = mergeWindows(windows, attackMs + releaseMs).filter(
    ([, e]) => e - clipAtMs > 0, // drop windows entirely before this clip starts
  );
  if (merged.length === 0) return [];
  const at = (ms: number) => Math.max(0, Math.round(ms - clipAtMs));
  const kf: Array<{ atMs: number; gain: number }> = [{ atMs: 0, gain: 0 }];
  for (const [s, e] of merged) {
    kf.push({ atMs: at(s - attackMs), gain: 0 });
    kf.push({ atMs: at(s), gain: amountDb });
    kf.push({ atMs: at(e), gain: amountDb });
    kf.push({ atMs: at(e + releaseMs), gain: 0 });
  }
  // Collapse keyframes that land on the same ms (volumeExpr treats them as a
  // step anyway) — keep the last write at each time, preserving order.
  const byMs = new Map<number, number>();
  for (const k of kf) byMs.set(k.atMs, k.gain);
  return [...byMs.entries()].sort((a, b) => a[0] - b[0]).map(([atMs, gain]) => ({ atMs, gain }));
}

/**
 * Resolve `duck` clips into concrete `gainKeyframes`: each ducked clip dips
 * under the union of every non-ducked clip's [atMs, atMs+durationMs] window.
 * Pure — runs at mux time on the resolved clip list. A clip with explicit
 * `gainKeyframes` is left as-is (manual automation wins).
 */
export function applyDucking(clips: AudioManifest): AudioManifest {
  if (!clips.some((c) => c.duck)) return clips;
  // Key windows come from clips that aren't themselves ducked and have a known
  // length (e.g. narration — prepareNarration measures it).
  const windows = clips
    .filter((c) => !c.duck && c.durationMs != null)
    .map((c) => [c.atMs, c.atMs + (c.durationMs ?? 0)] as [number, number]);
  return clips.map((clip) => {
    if (!clip.duck || (clip.gainKeyframes && clip.gainKeyframes.length > 0)) return clip;
    const opts = typeof clip.duck === "object" ? clip.duck : {};
    const kf = duckKeyframes(windows, clip.atMs, opts);
    return kf.length > 0 ? { ...clip, gainKeyframes: kf } : clip;
  });
}
