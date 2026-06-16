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

// ---- spring -------------------------------------------------------
export interface SpringConfig {
  stiffness?: number;
  damping?: number;
  mass?: number;
}

/**
 * A physical spring as an easing function. `p` is treated as the spring's
 * time (so a window of `ramp(ms, 0, D, …, spring())` settles over D), and the
 * output settles toward 1 — overshooting past it for low damping. Analytical
 * and deterministic (no per-frame state), so it's safe for parallel capture.
 */
export function spring(config: SpringConfig = {}): Ease {
  const { stiffness = 100, damping = 10, mass = 1 } = config;
  const w0 = Math.sqrt(stiffness / mass); // natural angular frequency
  const zeta = damping / (2 * Math.sqrt(stiffness * mass)); // damping ratio
  return (p: number): number => {
    if (p <= 0) return 0;
    const t = p;
    if (zeta < 1) {
      const wd = w0 * Math.sqrt(1 - zeta * zeta);
      return (
        1 -
        Math.exp(-zeta * w0 * t) *
          (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t))
      );
    }
    if (zeta === 1) {
      return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
    }
    // over-damped
    const s = Math.sqrt(zeta * zeta - 1);
    const r1 = -w0 * (zeta - s);
    const r2 = -w0 * (zeta + s);
    return 1 - (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1);
  };
}

// ---- track (multi-stop interpolation) -----------------------------
export interface TrackStop {
  /** time in ms (on the current clock) */
  at: number;
  value: number;
  /** easing for the segment ending at this stop (default linear) */
  ease?: Ease;
}

/**
 * Interpolate a value across many keyframes — the multi-stop `ramp`. Holds
 * flat before the first and after the last stop; each segment can ease.
 */
export function track(ms: number, stops: TrackStop[]): number {
  if (stops.length === 0) return 0;
  const sorted = [...stops].sort((a, b) => a.at - b.at);
  if (ms <= sorted[0]!.at) return sorted[0]!.value;
  const last = sorted[sorted.length - 1]!;
  if (ms >= last.at) return last.value;
  let i = 0;
  while (i < sorted.length - 1 && ms >= sorted[i + 1]!.at) i++;
  const a = sorted[i]!;
  const b = sorted[i + 1]!;
  const ease = b.ease ?? eases.linear;
  const p = (ms - a.at) / (b.at - a.at);
  return a.value + (b.value - a.value) * ease(p);
}

// ---- stagger ------------------------------------------------------
export interface StaggerOptions {
  /** delay between consecutive items, in ms (default 80) */
  each?: number;
  /** anchor: "start" | "end" | "center" | a specific index */
  from?: "start" | "end" | "center" | number;
  /** item count (required for "end" / "center") */
  total?: number;
}

/** Delay (ms) for item `i` in a staggered group — add it to a start time. */
export function stagger(i: number, options: StaggerOptions = {}): number {
  const { each = 80, from = "start", total = 0 } = options;
  let distance: number;
  if (from === "start") distance = i;
  else if (from === "end") distance = Math.max(0, total - 1) - i;
  else if (from === "center") distance = Math.abs(i - (total - 1) / 2);
  else distance = Math.abs(i - from);
  return distance * each;
}

// ---- color --------------------------------------------------------
function parseHex(hex: string): [number, number, number] {
  let h = hex.replace(/^#/, "");
  if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!;
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** Interpolate between two hex colors (sRGB), returning `rgb(r, g, b)`. */
export function interpolateColor(a: string, b: string, t: number): string {
  const p = t < 0 ? 0 : t > 1 ? 1 : t;
  const ca = parseHex(a);
  const cb = parseHex(b);
  const mix = (i: number) => Math.round(ca[i]! + (cb[i]! - ca[i]!) * p);
  return `rgb(${mix(0)}, ${mix(1)}, ${mix(2)})`;
}
