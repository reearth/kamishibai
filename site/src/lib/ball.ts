// The bouncing ball on the top page: a 32-frame reel at 24 fps.
// ------------------------------------------------------------------
// Frame i is drawn from i alone (closed form, nothing carried between
// frames), which is the point the page makes. The build draws the contact
// sheet with it, and the browser draws the big preview with it.
// ------------------------------------------------------------------

export const FRAMES = 32;
export const FPS = 24;

export interface BallFrame {
  /** centre x, in % of the frame width */
  x: number;
  /** bottom of the ball, in % of the frame height */
  y: number;
  sx: number;
  sy: number;
}

const clamp = (v: number) => Math.max(0, Math.min(1, v));

/** Rest 4 frames, bounce three times across in 24, rest 4. */
export function ballAt(i: number): BallFrame {
  const p = clamp((i - 4) / 23);
  const h = Math.abs(Math.sin(Math.PI * 3 * p)) * 52 * (1 - 0.55 * p);
  // Squash on contact, only while it's bouncing.
  const squash = i >= 4 && i <= 27 ? Math.max(0, 1 - h / 6) * 0.28 : 0;
  return { x: 12 + p * 72, y: 84 - h, sx: 1 + squash, sy: 1 - squash };
}

/** Whether frame i draws exactly what frame i - 1 drew: a render copies it. */
export function isCopy(i: number): boolean {
  if (i === 0) return false;
  const a = ballAt(i - 1);
  const b = ballAt(i);
  return a.x === b.x && a.y === b.y && a.sx === b.sx && a.sy === b.sy;
}

/** The transform that puts the ball at frame f (its box is centred, bottom-anchored). */
export function ballStyle(f: BallFrame): string {
  return `left: ${f.x.toFixed(2)}%; top: ${f.y.toFixed(2)}%; transform: translate(-50%, -100%) scale(${f.sx.toFixed(3)}, ${f.sy.toFixed(3)});`;
}
