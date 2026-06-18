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
   * fade this scene's content out over its last `exitFadeMs` ms. Pairs with
   * a crossfade to avoid ghosting: the outgoing content is gone before the
   * incoming scene arrives, so only the backgrounds blend (default 0).
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
 * Resolve each scene's start and crossfade envelope from its spec.
 * `start_i = start_{i-1} + dur_{i-1} − crossfade_i` (the first scene starts
 * at 0; a crossfade pulls the next scene earlier so the two overlap).
 */
export function seriesLayout(scenes: SceneSpec[]): SceneLayout[] {
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
 * Total length of a Series, in ms: `Σ durations − Σ crossfades`. Feed this to
 * `meta.durationMs` so the reel ends exactly when the last scene does — too
 * long leaves trailing blank frames, too short cuts the last scene.
 */
export function seriesDuration(scenes: SceneSpec[]): number {
  return scenes.reduce(
    (total, s, i) => total + s.durationMs - (i === 0 ? 0 : (s.crossfadeMs ?? 0)),
    0,
  );
}
