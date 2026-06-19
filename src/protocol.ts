// kamishibai — the one and only contract
// ------------------------------------------------------------------
// A page that wants to be captured exposes exactly one global:
//
//   window.kamishibai = {
//     meta: { fps, durationMs, width, height },
//     seek(ms): Promise<void>,
//   };
//
// `seek(ms)` builds the *still state* for a given moment and resolves
// once the DOM has settled (so a screenshot is taken against a painted,
// stable frame). What happens inside seek — a React re-render, a manual
// ctx.clearRect, a Konva layer.draw() — is entirely up to the page.
//
// The renderer never plays back in real time. It seeks to a moment,
// screenshots, advances, and repeats. Because each frame is a pure
// function of its time, any Chrome can render any frame range and get
// the same pixels — which is what makes parallel capture safe.
// ------------------------------------------------------------------

/** Describes the reel: how many frames, how big, how long. */
export interface KamishibaiMeta {
  /** ticks per second the renderer samples */
  fps: number;
  /** total reel length in milliseconds */
  durationMs: number;
  /** capture width in CSS pixels */
  width: number;
  /** capture height in CSS pixels */
  height: number;
}

/** The single object a capturable page must expose on `window`. */
export interface KamishibaiPage {
  meta: KamishibaiMeta;
  /**
   * Render the still state for `ms` and resolve once it has settled.
   * Must be deterministic: the same `ms` always yields the same pixels.
   *
   * The return value controls capture:
   *   - `false`  — identical to the previous frame: the renderer copies the
   *     previous still instead of paying for a settle + screenshot, cheaply
   *     skipping static spans.
   *   - `string` — a *fingerprint* of this frame's content. The renderer uses
   *     it both to skip static spans (equal to the previous frame's print ->
   *     copy) and, with --incremental, to reuse a cached PNG across runs
   *     (equal to last run's print -> keep the file). kamishibai/react returns
   *     one automatically by hashing the committed DOM.
   *   - `void`/`true` — capture normally (the default, fully backward
   *     compatible).
   */
  seek(ms: number): Promise<boolean | string | void> | boolean | string | void;
  /**
   * Optional audio markers for muxing, collected from the page after capture
   * when the caller passes no explicit manifest. Either populated by
   * kamishibai/react's <Audio>, or by hand: push { src, atMs, gain? } entries
   * (src is a path ffmpeg can read, atMs is the start time in milliseconds).
   */
  audio?: Array<{
    src: string;
    atMs: number;
    gain?: number;
    trimStartMs?: number;
    durationMs?: number;
    fadeInMs?: number;
    fadeOutMs?: number;
    loop?: boolean;
    duck?: boolean | { amountDb?: number; attackMs?: number; releaseMs?: number };
    gainKeyframes?: Array<{ atMs: number; gain: number }>;
  }>;
  /**
   * Optional subtitle cues for muxing, collected from the page after capture —
   * the visual counterpart of `audio`. By default kamishibai/react's <Subtitle>
   * pushes its cues here (with absolute, reel-global ms) instead of drawing
   * pixels, and the renderer bakes them into a soft mp4 track + a sidecar .srt.
   * Populate by hand for a raw page: push { start, end, text } in global ms.
   */
  subtitles?: Array<{ start: number; end: number; text: string }>;
}

declare global {
  interface Window {
    kamishibai?: KamishibaiPage;
  }
}

/** The global name the renderer looks for on the page. */
export const GLOBAL_KEY = "kamishibai" as const;

/** Total number of frames a reel of this meta produces. */
export function frameCount(meta: Pick<KamishibaiMeta, "fps" | "durationMs">): number {
  return Math.round((meta.durationMs / 1000) * meta.fps);
}

/** The timestamp (ms) of frame index `i` at the given fps. */
export function frameTimeMs(i: number, fps: number): number {
  return (i * 1000) / fps;
}
