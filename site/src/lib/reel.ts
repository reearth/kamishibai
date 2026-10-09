// Make a page of this site a kamishibai reel.
// ------------------------------------------------------------------
// Each page draws everything from one clock. In a browser the clock is the
// wall clock; once kamishibai calls seek(ms), the page is driven instead and
// draws exactly that moment, so `kamishibai render <page url>` turns the page
// itself into a video. The site is its own example.
// ------------------------------------------------------------------
import type { Shape } from "./draw.ts";

export interface ReelMeta {
  fps: number;
  durationMs: number;
  width: number;
  height: number;
}

declare global {
  interface Window {
    kamishibai?: { meta: ReelMeta; seek(ms: number): Promise<void> };
  }
}

/**
 * Run `draw(ms, false)` every animation frame on the wall clock, and expose
 * window.kamishibai so a renderer can call `draw(ms, true)` with any ms
 * instead (the wall clock then stops).
 */
export function reel(meta: ReelMeta, draw: (ms: number, driven: boolean) => void): void {
  let driven = false;
  const t0 = performance.now();
  const loop = (now: number) => {
    if (driven) return;
    draw(now - t0, false);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  window.kamishibai = {
    meta,
    async seek(ms) {
      driven = true;
      draw(ms, true);
    },
  };
}

/** Put a drawing's shapes onto the elements a frame already has. */
export function paint(frame: HTMLElement, shapes: Shape[]): void {
  const els = frame.children;
  shapes.forEach((s, i) => {
    const el = els[i] as HTMLElement | undefined;
    if (el) Object.assign(el.style, s);
  });
}

/** A shape as an inline style, for the frame the build writes. */
export function shapeStyle(s: Shape): string {
  return [
    `left:${s.left}`, `top:${s.top}`, `width:${s.width}`, `height:${s.height}`,
    `border-radius:${s.borderRadius}`, `background:${s.background}`, `opacity:${s.opacity}`,
    `filter:${s.filter}`, `transform:${s.transform}`, `transform-origin:${s.transformOrigin}`, `box-shadow:${s.boxShadow}`,
  ].join(";");
}
