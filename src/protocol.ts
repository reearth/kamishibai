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
   * Return `false` to signal this frame is identical to the previous one:
   * the renderer then copies the previous still instead of paying for a
   * settle + screenshot, which cheaply skips static spans. Returning
   * `void` or `true` captures normally (the default, fully backward
   * compatible).
   */
  seek(ms: number): Promise<boolean | void> | boolean | void;
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
    gainKeyframes?: Array<{ atMs: number; gain: number }>;
  }>;
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
