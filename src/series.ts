// Laying scenes out on a timeline (framework-free).
// ------------------------------------------------------------------
// A Series is a list of scenes played back-to-back. A scene can crossfade
// in over `crossfadeMs`, overlapping the previous one — so scene i starts at
// Σ(prev durations) − Σ(prev crossfades). This math is the single source of
// truth for both the React <Series> layout and the `seriesDuration` helper,
// so the number you feed `meta.durationMs` always matches what renders.
// ------------------------------------------------------------------

/** The timing of one scene. Pure data — no React, no rendering. */
export interface SceneSpec {
  /** how long this scene is on screen, in ms (before crossfade overlap) */
  durationMs: number;
  /** crossfade-in length in ms; overlaps the previous scene (default 0) */
  crossfadeMs?: number;
  /**
   * fade this scene's content out over `exitFadeMs` ms, ending where the next
   * scene's crossfade begins (or at the scene end when there is none). Pairs
   * with a crossfade to avoid ghosting: the outgoing content is gone before
   * the incoming scene arrives. In kamishibai/react a `<Stage background>`
   * directly in the scene keeps its background, so only the backgrounds
   * blend; content outside a Stage fades with everything else (default 0).
   */
  exitFadeMs?: number;
}

/** Where a scene lands on the timeline, plus its crossfade envelope. */
export interface SceneLayout {
  /** start of the scene on the Series timeline, in ms */
  start: number;
  /** the scene's own duration, in ms */
  durationMs: number;
  /** crossfade-in length applied at the scene's start (0 for the first) */
  xfIn: number;
  /** crossfade-out length applied at the scene's end (= next scene's xfIn) */
  xfOut: number;
  /** content exit-fade length applied at the scene's end */
  exitFadeMs: number;
}

/**
 * Reject timings that can't form a timeline: negative lengths, or a crossfade
 * longer than either scene it joins (the incoming scene would start before the
 * outgoing one, or never reach full opacity). Throws a RangeError.
 */
function checkScenes(scenes: SceneSpec[]): void {
  scenes.forEach((s, i) => {
    const xf = s.crossfadeMs ?? 0;
    const bad = (why: string) => {
      throw new RangeError(`kamishibai: scene ${i}: ${why}`);
    };
    if (!(s.durationMs >= 0)) bad(`durationMs must be >= 0 (got ${s.durationMs})`);
    if (!(xf >= 0)) bad(`crossfadeMs must be >= 0 (got ${xf})`);
    if (!((s.exitFadeMs ?? 0) >= 0)) bad(`exitFadeMs must be >= 0 (got ${s.exitFadeMs})`);
    if (i === 0) return;
    if (xf > s.durationMs) bad(`crossfadeMs ${xf} exceeds its own durationMs ${s.durationMs}`);
    const prev = scenes[i - 1]!.durationMs;
    if (xf > prev) bad(`crossfadeMs ${xf} exceeds the previous scene's durationMs ${prev}`);
  });
}

/**
 * Resolve each scene's start and crossfade envelope from its spec.
 * `start_i = start_{i-1} + dur_{i-1} − crossfade_i` (the first scene starts
 * at 0; a crossfade pulls the next scene earlier so the two overlap).
 * Throws a RangeError for degenerate timings (see checkScenes).
 */
export function seriesLayout(scenes: SceneSpec[]): SceneLayout[] {
  checkScenes(scenes);
  const starts: number[] = [];
  let cursor = 0;
  scenes.forEach((s, i) => {
    const xf = i === 0 ? 0 : (s.crossfadeMs ?? 0);
    cursor -= xf;
    starts.push(cursor);
    cursor += s.durationMs;
  });
  return scenes.map((s, i) => ({
    start: starts[i]!,
    durationMs: s.durationMs,
    xfIn: i > 0 ? (s.crossfadeMs ?? 0) : 0,
    xfOut: scenes[i + 1] ? (scenes[i + 1]!.crossfadeMs ?? 0) : 0,
    exitFadeMs: s.exitFadeMs ?? 0,
  }));
}

/**
 * Opacity of a scene's content at `local` ms under its exit-fade (1 when the
 * scene has none). The fade *ends where the next scene's crossfade begins*
 * (`durationMs − xfOut`), not at the scene end — so the outgoing content is
 * fully gone before the incoming scene starts to show. Ending it at the scene
 * end instead would leave the old content visible under the incoming one for
 * the whole overlap. An exit-fade longer than `durationMs − xfOut` starts
 * before the scene does, so the content is already partly faded at local 0.
 */
export function exitFadeOpacity(place: SceneLayout, local: number): number {
  if (place.exitFadeMs <= 0) return 1;
  const end = Math.max(0, place.durationMs - place.xfOut);
  const start = end - place.exitFadeMs;
  if (local < start) return 1;
  if (local >= end) return 0;
  return (end - local) / place.exitFadeMs;
}

/**
 * Total length of a Series, in ms: `Σ durations − Σ crossfades`. Feed this to
 * `meta.durationMs` so the reel ends exactly when the last scene does — too
 * long leaves trailing blank frames, too short cuts the last scene. Throws a
 * RangeError for degenerate timings, like seriesLayout.
 */
export function seriesDuration(scenes: SceneSpec[]): number {
  checkScenes(scenes);
  return scenes.reduce(
    (total, s, i) => total + s.durationMs - (i === 0 ? 0 : (s.crossfadeMs ?? 0)),
    0,
  );
}
