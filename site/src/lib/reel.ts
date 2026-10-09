// Make a page of this site a kamishibai reel.
// ------------------------------------------------------------------
// Each page draws everything from one clock. In a browser the clock is the
// wall clock; once kamishibai calls seek(ms), the page is driven instead and
// draws exactly that moment, so `kamishibai render <page url>` turns the page
// itself into a video. The site is its own example.
// ------------------------------------------------------------------
import { H, PAINT, SHAPES, W, type Shape } from "./draw.ts";

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

/**
 * Draw term `id` at loop progress t into its frame: its shapes onto the
 * elements the frame already has, or its paint onto the frame's canvas.
 */
export function drawTerm(frame: HTMLElement, id: string, t: number): void {
  const p = PAINT[id];
  if (p) {
    const cv = frame.firstElementChild as HTMLCanvasElement | null;
    const g = cv?.getContext("2d");
    if (!cv || !g || !cv.clientWidth) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }
    g.setTransform(w / W, 0, 0, h / H, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    g.clearRect(0, 0, W, H);
    g.save();
    p(g, t);
    g.restore();
    return;
  }
  const els = frame.children;
  SHAPES[id]?.(t).forEach((s: Shape, i) => {
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
