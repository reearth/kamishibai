// Audio is a declaration, not a generation step.
// ------------------------------------------------------------------
// kamishibai never makes sound. You hand it files + start times (from a
// TTS, a music track, whatever), and they get muxed at assembly time.
// ------------------------------------------------------------------

export interface AudioClip {
  /** path to an audio file, or a video file whose audio track to use
   *  (relative to the render's working dir, or absolute). "" is a
   *  placeholder for a sound that has no file yet (a narration line
   *  `kamishibai dev` hasn't synthesized): it is never muxed, and the dev
   *  player shows its `label` instead */
  src: string;
  /** what the clip is, for people: the dev player shows it in storyboard
   *  mode (a narration line's caption, say). Never muxed. */
  label?: string;
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
   * Auto-duck this clip under the others: from every clip's start and length,
   * kamishibai derives `gainKeyframes` that dip this clip while any
   * *non-ducked* clip (e.g. narration) is playing, ramping back up in the gaps.
   * Ducked clips never dip under each other. A clip's length is its
   * `durationMs` (capped by its source's length after `trimStartMs`), else its
   * source's length after `trimStartMs` (probed with ffprobe when rendering),
   * else — for a `loop` clip — up to the reel end; a clip whose length can't be
   * known doesn't trigger a dip.
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

/**
 * The canonical identity of a clip: every field, in a fixed order. Two markers
 * with the same key are the same clip (e.g. one scene reported by two capture
 * chunks); any differing field — trim, length, fades, loop, duck, keyframes —
 * makes them distinct clips that both mux. Used by the React marker registry
 * and the parallel-capture merge, so both dedup the same way.
 */
export function clipKey(c: AudioClip): string {
  return JSON.stringify([
    c.src,
    c.atMs,
    c.gain ?? 0,
    c.trimStartMs ?? 0,
    c.durationMs ?? null,
    c.fadeInMs ?? 0,
    c.fadeOutMs ?? 0,
    !!c.loop,
    c.duck ?? false,
    c.gainKeyframes ?? null,
    c.label ?? null,
  ]);
}

/**
 * A deduplicating list of clip markers. `register` adds a clip unless an
 * identical one (same clipKey) is already there, and returns its key. A
 * declaration passes back the key it registered last as `prevKey`: when its
 * clip changed (e.g. a length that resolved after the first render), the stale
 * entry is removed and the new one added, instead of the new clip being
 * dropped. Identical declarations share one entry, so if one of them changes,
 * the shared entry is replaced as well (known limit; it needs two identical
 * clips declared at once, one of which then changes). `clips` is a live array (exposed as
 * window.kamishibai.audio); `reset` empties it in place.
 */
export function createClipRegistry(): {
  clips: AudioClip[];
  register(clip: AudioClip, prevKey?: string): string;
  reset(): void;
} {
  const clips: AudioClip[] = [];
  // Keys are recomputed from `clips` (not kept in a parallel list) so the
  // registry stays right even if a page pushes onto the live array itself.
  const indexOf = (key: string) => clips.findIndex((c) => clipKey(c) === key);
  return {
    clips,
    register(clip, prevKey) {
      const key = clipKey(clip);
      if (prevKey !== undefined && prevKey !== key) {
        const i = indexOf(prevKey);
        if (i >= 0) clips.splice(i, 1);
      }
      if (indexOf(key) < 0) clips.push(clip);
      return key;
    },
    reset() {
      clips.length = 0;
    },
  };
}

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

/** What `applyDucking` may know beyond the clips themselves. */
export interface DuckContext {
  /** the reel length in ms — ends a `loop` clip without `durationMs`, and
   *  clamps every window (the mux clamps the output to the reel) */
  reelMs?: number;
  /** each source's full length in ms, keyed by the clip's (resolved) src —
   *  e.g. probed with ffprobe */
  sourceMs?: ReadonlyMap<string, number>;
}

/**
 * The [start, end) window in which a non-ducked clip is audible, or undefined
 * when its length can't be known. Mirrors how the mux plays it: `durationMs`
 * caps it (a non-loop clip also stops when its trimmed source runs out), a
 * `loop` clip without `durationMs` runs to the reel end, and a plain clip plays
 * its source from `trimStartMs` to the end.
 */
function clipWindow(c: AudioClip, ctx: DuckContext): [number, number] | undefined {
  const full = ctx.sourceMs?.get(c.src);
  const rest = full != null ? Math.max(0, full - (c.trimStartMs ?? 0)) : undefined;
  let len: number | undefined;
  if (c.loop) len = c.durationMs ?? (ctx.reelMs != null ? ctx.reelMs - c.atMs : undefined);
  else if (c.durationMs != null) len = rest != null ? Math.min(c.durationMs, rest) : c.durationMs;
  else len = rest;
  if (len == null) return undefined;
  const end = c.atMs + len;
  return [c.atMs, ctx.reelMs != null ? Math.min(end, ctx.reelMs) : end];
}

/**
 * Resolve `duck` clips into concrete `gainKeyframes`: each ducked clip dips
 * under the union of every non-ducked clip's audible window (see clipWindow —
 * a clip of unknown length, i.e. no `durationMs`, no probed source length and
 * not a loop with a known reel end, contributes none). Pure — runs at mux time
 * on the resolved clip list, with the source lengths the render probed. A clip
 * with explicit `gainKeyframes` is left as-is (manual automation wins).
 */
export function applyDucking(clips: AudioManifest, ctx: DuckContext = {}): AudioManifest {
  if (!clips.some((c) => c.duck)) return clips;
  // Key windows come from clips that aren't themselves ducked (e.g. narration).
  const windows = clips
    .filter((c) => !c.duck)
    .map((c) => clipWindow(c, ctx))
    .filter((w): w is [number, number] => w != null);
  return clips.map((clip) => {
    if (!clip.duck || (clip.gainKeyframes && clip.gainKeyframes.length > 0)) return clip;
    const opts = typeof clip.duck === "object" ? clip.duck : {};
    const kf = duckKeyframes(windows, clip.atMs, opts);
    return kf.length > 0 ? { ...clip, gainKeyframes: kf } : clip;
  });
}
