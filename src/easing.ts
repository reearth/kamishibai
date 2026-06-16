// kamishibai/easing — time → value helpers. Pure, framework-free.
// ------------------------------------------------------------------
// Usable from anything: the raw window.kamishibai API, the React sugar,
// or Node-side code computing values. No DOM or React dependency.
// ------------------------------------------------------------------

/** An easing function: maps progress p in [0,1] to an eased [0,1]. */
export type Ease = (p: number) => number;

/**
 * A cubic-bezier easing (the same curve math CSS timing functions use).
 * Returns an Ease for the control points (x1,y1,x2,y2).
 */
export function bezier(x1: number, y1: number, x2: number, y2: number): Ease {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;

  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

  return (p: number): number => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    // Newton-Raphson to invert x(t) = p, then read y(t).
    let t = p;
    for (let i = 0; i < 6; i++) {
      const x = sampleX(t) - p;
      const d = slopeX(t);
      if (Math.abs(x) < 1e-6 || Math.abs(d) < 1e-6) break;
      t -= x / d;
    }
    return sampleY(t);
  };
}

/** A small set of ready-made easings. */
export const eases = {
  linear: (p: number) => p,
  smooth: bezier(0.16, 1, 0.3, 1), // crisp deceleration, no overshoot
  inOut: bezier(0.45, 0, 0.55, 1), // balanced
  pop: bezier(0.34, 1.56, 0.64, 1), // slight overshoot
};

/**
 * Map a time window [fromMs, toMs] onto [fromV, toV], clamped at both ends,
 * shaped by an easing curve. Scalar args by design — no arrays.
 */
export function ramp(
  ms: number,
  fromMs: number,
  toMs: number,
  fromV: number,
  toV: number,
  ease: Ease = eases.linear,
): number {
  if (toMs <= fromMs) return ms < fromMs ? fromV : toV;
  const raw = (ms - fromMs) / (toMs - fromMs);
  const p = raw < 0 ? 0 : raw > 1 ? 1 : raw;
  return fromV + (toV - fromV) * ease(p);
}
