// What every Lexicon drawing is made with.
// ------------------------------------------------------------------
// A term's loop is drawn one of two ways, both functions of t in [0, 1),
// the loop's progress, with nothing carried over between frames:
//
//   Shapes: (t) => Shape[]. A few rectangles and circles placed in % of
//     the 4:3 frame. The build draws t = 0 into the page, so the picture is
//     there before any script runs. Return the same number of shapes for
//     every t: the page reuses the elements it drew at t = 0.
//   Paint: (g, t) => void. Draws on a canvas whose units are always
//     W × H (400 × 300), whatever its size on screen. For textures, noise,
//     particles, type and anything else shapes can't do.
//
// Each loop repeats seamlessly: what it draws at t = 1 is what it draws at
// t = 0. Randomness comes from rand(), seeded, never Math.random().
// ------------------------------------------------------------------

export interface Shape {
  left: string;
  top: string;
  width: string;
  height: string;
  borderRadius: string;
  background: string;
  opacity: number;
  filter: string;
  transform: string;
  transformOrigin: string;
  boxShadow: string;
}

export type Shapes = (t: number) => Shape[];
export type Paint = (g: CanvasRenderingContext2D, t: number) => void;

/** The canvas a Paint draws on, in its own units. */
export const W = 400;
export const H = 300;
export const TAU = Math.PI * 2;

// The palette: ink on white paper, the kamishibai orange and its tints.
// A technique that is about colour (RGB split, duotone…) may bring its own.
export const INK = "#121212";
export const INK_2 = "#3E3E3A";
export const PAPER = "#FFFFFF";
export const KAKI = "#D9662A";
export const KAKI_2 = "#E8955F";
export const PALE = "#F2C3A0";
export const GREY = "#C8CBD2";
export const GREY_2 = "#9EA2AB";
export const MIST = "#EFEEE9";
/** the ground of a frame drawn dark (Term.dark) */
export const NIGHT = "#1E1A17";

// ---- time ----
export const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
export const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
/** 0 → 1 as t goes from a to b */
export const span = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
export const inOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
export const out = (p: number) => 1 - Math.pow(1 - p, 3);
export const inCubic = (p: number) => p * p * p;
export const smooth = (p: number) => p * p * (3 - 2 * p);
/** 0 → 1 → 0 over the loop, so a move that goes out and back repeats seamlessly */
export const pingPong = (t: number) => (t < 0.5 ? t * 2 : 2 - t * 2);
export const wrap = (x: number, n: number) => ((x % n) + n) % n;

// ---- randomness that repeats ----
/** A fixed random number in [0, 1) for each integer-ish seed. */
export function rand(...seed: number[]): number {
  let h = 2166136261;
  for (const s of seed) {
    h = Math.imul(h ^ Math.floor(s * 1000003), 16777619);
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
  }
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in about [0, 1], continuous in x and y. */
export function noise(x: number, y = 0, seed = 0): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = smooth(x - xi), yf = smooth(y - yi);
  const a = rand(xi, yi, seed), b = rand(xi + 1, yi, seed);
  const c = rand(xi, yi + 1, seed), d = rand(xi + 1, yi + 1, seed);
  return lerp(lerp(a, b, xf), lerp(c, d, xf), yf);
}

/** Noise that comes back to where it started at t = 1: a walk round a circle in the noise field. */
export function loopNoise(t: number, seed = 0, r = 1.5): number {
  return noise(10 + r * Math.cos(TAU * t), 10 + r * Math.sin(TAU * t), seed);
}

// ---- shapes ----
export const pct = (v: number) => `${v.toFixed(2)}%`;

export function mix(a: string, b: string, f: number): string {
  const ch = (s: string, i: number) => parseInt(s.slice(i, i + 2), 16);
  return "#" + [1, 3, 5].map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * f).toString(16).padStart(2, "0")).join("");
}

type Extra = Partial<Pick<Shape, "borderRadius" | "opacity" | "filter" | "transform" | "transformOrigin" | "boxShadow">>;

export function rect(l: number, t: number, w: number, h: number, background: string, extra: Extra = {}): Shape {
  return {
    left: pct(l), top: pct(t), width: pct(w), height: pct(h), background,
    borderRadius: "0", opacity: 1, filter: "none", transform: "none", transformOrigin: "50% 50%", boxShadow: "none",
    ...extra,
  };
}

/** A circle of diameter d, in % of the width (so d · 4/3 in % of the 4:3 height). */
export function circle(cx: number, cy: number, d: number, background: string, extra: Extra = {}): Shape {
  const h = (d * 4) / 3;
  return rect(cx - d / 2, cy - h / 2, d, h, background, { borderRadius: "50%", ...extra });
}

export const ground = (y: number) => rect(0, y, 100, 100 - y, MIST);
export const blur = (px: number) => ({ filter: `blur(${px.toFixed(1)}px)` });

// ---- canvas ----
export function fill(g: CanvasRenderingContext2D, color: string): void {
  g.fillStyle = color;
  g.fillRect(0, 0, W, H);
}

export function dot(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  g.fillStyle = color;
  g.beginPath();
  g.arc(x, y, Math.max(0, r), 0, TAU);
  g.fill();
}

/** Set type in the site's face. weight 800 is the headline weight. */
export function font(g: CanvasRenderingContext2D, px: number, weight = 800): void {
  g.font = `${weight} ${px}px Geist, "Zen Kaku Gothic New", system-ui, sans-serif`;
}
