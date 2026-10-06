// Camera moves over a "world" — pure keyframe math, no React.
// ------------------------------------------------------------------
// A camera here is just "which world point sits at the center of the frame,
// and how far in we are". Shots are keyframes on the reel clock; between them
// the position eases and the zoom interpolates *geometrically* (in log space),
// so going 1× → 4× feels as even as 4× → 16× instead of rushing at the start.
import { eases, type Ease } from "./easing.ts";

/** Where the camera looks: a world point at the frame center, and a zoom. */
export interface CameraState {
  x: number;
  y: number;
  /** scale factor (1 = world units are pixels, 2 = twice as close) */
  zoom: number;
  /** roll in degrees (default 0) */
  rotate?: number;
}

/** A keyframe: be at this state at `at` ms; `ease` shapes the move *into* it
 *  (default eases.inOut). */
export interface CameraShot extends CameraState {
  at: number;
  ease?: Ease;
}

/** The camera state at `ms`, interpolated across `shots` (held before the
 *  first and after the last). */
export function cameraAt(ms: number, shots: CameraShot[]): CameraState {
  if (shots.length === 0) return { x: 0, y: 0, zoom: 1, rotate: 0 };
  const sorted = [...shots].sort((a, b) => a.at - b.at);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const state = (s: CameraShot): CameraState => ({ x: s.x, y: s.y, zoom: s.zoom, rotate: s.rotate ?? 0 });
  if (ms <= first.at) return state(first);
  if (ms >= last.at) return state(last);
  let i = 0;
  while (i < sorted.length - 1 && ms >= sorted[i + 1]!.at) i++;
  const a = sorted[i]!;
  const b = sorted[i + 1]!;
  const p = (b.ease ?? eases.inOut)((ms - a.at) / (b.at - a.at));
  const lerp = (u: number, v: number) => u + (v - u) * p;
  return {
    x: lerp(a.x, b.x),
    y: lerp(a.y, b.y),
    zoom: Math.exp(lerp(Math.log(a.zoom), Math.log(b.zoom))),
    rotate: lerp(a.rotate ?? 0, b.rotate ?? 0),
  };
}

/** CSS transform that puts world point (x, y) at the origin of its container,
 *  zoomed and rolled — apply it to a world layer positioned at the frame
 *  center with `transform-origin: 0 0`. */
export function cameraTransform(c: CameraState): string {
  return `scale(${c.zoom}) rotate(${-(c.rotate ?? 0)}deg) translate(${-c.x}px, ${-c.y}px)`;
}
