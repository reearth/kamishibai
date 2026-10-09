// How each Lexicon term's loop is drawn.
// ------------------------------------------------------------------
// Every drawing is a function of t in [0, 1): the loop's progress. It
// returns a few rectangles and circles, placed in % of a 4:3 frame. Nothing
// carries over between frames, so any frame can be drawn on its own, which
// is all kamishibai asks of a reel. Each one also repeats seamlessly: what
// it draws at t = 1 is what it draws at t = 0.
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

export const INK = "#121212";
const PAPER = "#FFFFFF";
const KAKI = "#D9662A";
const PALE = "#F2C3A0";
const GREY = "#C8CBD2";
const MIST = "#EFEEE9";

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const inOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const out = (p: number) => 1 - Math.pow(1 - p, 3);
/** 0 → 1 → 0 over the loop, so a move that goes out and back repeats seamlessly */
const pingPong = (t: number) => (t < 0.5 ? t * 2 : 2 - t * 2);
const pct = (v: number) => `${v.toFixed(2)}%`;
const wrap = (x: number, span: number) => ((x % span) + span) % span;

function mix(a: string, b: string, f: number): string {
  const ch = (s: string, i: number) => parseInt(s.slice(i, i + 2), 16);
  return "#" + [1, 3, 5].map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * f).toString(16).padStart(2, "0")).join("");
}

type Extra = Partial<Pick<Shape, "borderRadius" | "opacity" | "filter" | "transform" | "transformOrigin" | "boxShadow">>;

function rect(l: number, t: number, w: number, h: number, background: string, extra: Extra = {}): Shape {
  return {
    left: pct(l), top: pct(t), width: pct(w), height: pct(h), background,
    borderRadius: "0", opacity: 1, filter: "none", transform: "none", transformOrigin: "50% 50%", boxShadow: "none",
    ...extra,
  };
}

/** A circle of diameter d, in % of the width (so d · 4/3 in % of the 4:3 height). */
function circle(cx: number, cy: number, d: number, background: string, extra: Extra = {}): Shape {
  const h = (d * 4) / 3;
  return rect(cx - d / 2, cy - h / 2, d, h, background, { borderRadius: "50%", ...extra });
}

const ground = (y: number) => rect(0, y, 100, 100 - y, MIST);
const blur = (px: number) => ({ filter: `blur(${px.toFixed(1)}px)` });

export const DRAW: Record<string, (t: number) => Shape[]> = {
  pan: (t) => [
    ground(78),
    ...[30, 46, 24, 52, 36, 42].map((h, k) => rect(wrap(k * 22 - t * 132, 132) - 16, 78 - h, 12, h, k % 2 ? "#3E3E3A" : INK)),
  ],

  truck: (t) => [
    ground(78),
    ...[0, 1, 2].map((k) => rect(wrap(k * 45 - t * 135, 135) - 30, 46, 34, 32, GREY, { borderRadius: "50% 50% 0 0" })),
    ...[0, 1, 2, 3].map((k) => rect(wrap(k * 30 - t * 240, 120) - 10, 30, 5, 60, INK)),
  ],

  tilt: (t) => {
    const s = inOut(pingPong(t)) * 50;
    return [
      rect(0, 82 + s, 100, 40, MIST),
      rect(40, -20 + s, 20, 104, INK),
      ...[0, 1, 2, 3, 4].map((k) => rect(46, -10 + k * 18 + s, 8, 6, KAKI)),
    ];
  },

  "dolly-in": (t) => {
    const s = 1 + inOut(pingPong(t)) * 1.1;
    const b = 1 + inOut(pingPong(t)) * 0.35;
    return [
      ground(50 + 28 / b),
      rect(50 - 42 * b, 70 - 30 * b, 14 * b, 30 * b, GREY),
      rect(50 + 28 * b, 70 - 34 * b, 14 * b, 34 * b, GREY),
      circle(50, 62 - 8 * s, 14 * s, KAKI),
    ];
  },

  "dolly-zoom": (t) => {
    const k = 0.7 + inOut(pingPong(t)) * 0.9;
    return [
      ...[-3, -2, -1, 0, 1, 2, 3].map((j) => rect(50 + j * 15 * k - 2.5 * k, 50 - 40 * k, 5 * k, 80 * k, j % 2 ? GREY : "#9EA2AB")),
      circle(50, 58, 22, KAKI),
    ];
  },

  "whip-pan": (t) => {
    // There and back, so the loop closes: out over 0.25–0.4, back over 0.75–0.9.
    const there = clamp((t - 0.25) / 0.15);
    const back = clamp((t - 0.75) / 0.15);
    const p = there - back;
    const x = inOut(clamp(p)) * 100;
    const b = blur(Math.max(Math.sin(there * Math.PI), Math.sin(back * Math.PI)) * 10);
    return [
      circle(30 - x, 46, 26, KAKI, b),
      rect(56 - x, 30, 20, 40, INK, b),
      rect(120 - x, 26, 44, 48, INK, b),
      circle(130 - x, 50, 14, PALE, b),
    ];
  },

  "rack-focus": (t) => {
    const f = inOut(pingPong(t));
    return [ground(72), circle(66, 44, 16, INK, blur((1 - f) * 6)), circle(32, 64, 34, KAKI, blur(f * 6))];
  },

  "ease-in-out": (t) =>
    [0.06, 0.04, 0.02, 0].map((d, k) => circle(15 + inOut(pingPong(wrap(t - d, 1))) * 70, 50, 14, KAKI, { opacity: k === 3 ? 1 : 0.18 })),

  overshoot: (t) => {
    const u = clamp(t / 0.75);
    // Settles by u = 1, then waits; the jump back to the start is the loop's cut.
    const x = 15 + 65 * (1 - Math.exp(-6 * u) * Math.cos(11 * u));
    return [rect(79.5, 20, 1, 60, PALE), circle(x, 50, 14, KAKI)];
  },

  anticipation: (t) => {
    const u = clamp(t / 0.8);
    const x = u < 0.3 ? 24 - inOut(u / 0.3) * 8 : 16 + out(clamp((u - 0.3) / 0.45)) * 64;
    return [rect(10, 50, 80, 1, GREY), circle(x, 50, 14, KAKI)];
  },

  stagger: (t) =>
    [0, 1, 2, 3, 4, 5].map((k) => {
      const h = out(clamp((clamp(t / 0.8) * 1.6 - k * 0.12) / 0.5)) * (30 + k * 7);
      return rect(14 + k * 13, 80 - h, 9, h, k === 5 ? KAKI : INK);
    }),

  "squash-and-stretch": (t) => {
    const h = Math.abs(Math.sin(Math.PI * t)) * 52;
    const squash = Math.max(0, 1 - h / 7) * 0.32;
    const stretch = h > 7 ? Math.abs(Math.cos(Math.PI * t)) * 0.16 : 0;
    return [
      ground(80),
      circle(50, 80 - h - 9.3, 14, KAKI, {
        transform: `scale(${(1 + squash - stretch * 0.5).toFixed(3)}, ${(1 - squash + stretch).toFixed(3)})`,
        transformOrigin: "50% 100%",
      }),
    ];
  },

  nuki: (t) => {
    const x = t < 0.35 ? 0 : t < 0.45 ? out((t - 0.35) / 0.1) * 46 : t < 0.65 ? 46 : t < 0.75 ? 46 + Math.pow((t - 0.65) / 0.1, 3) * 70 : 116;
    return [
      rect(8, 10, 84, 80, "#3E3E3A"),
      rect(20, 30, 40, 8, PALE),
      rect(20, 46, 60, 6, GREY),
      rect(8 + x, 10, 84, 80, PAPER, { boxShadow: "-6px 0 14px rgba(0,0,0,.18)" }),
      circle(36 + x, 48, 22, KAKI),
      rect(60 + x, 30, 20, 40, INK),
    ];
  },

  crossfade: (t) => {
    const f = inOut(pingPong(t));
    return [
      circle(36, 50, 28, KAKI, { opacity: 1 - f }),
      rect(52, 30, 24, 40, INK, { opacity: 1 - f }),
      rect(20, 36, 60, 28, INK, { opacity: f }),
      circle(70, 50, 12, PALE, { opacity: f }),
    ];
  },

  wipe: (t) => {
    const x = inOut(pingPong(t)) * 100;
    return [circle(40, 50, 30, KAKI), rect(0, 0, x, 100, INK), rect(x - 0.6, 0, 1.2, 100, PALE)];
  },

  iris: (t) => [rect(0, 0, 100, 100, INK), circle(50, 50, inOut(pingPong(t)) * 140, PAPER), circle(50, 50, 18, KAKI)],

  push: (t) => {
    const x = inOut(pingPong(t)) * 100;
    return [circle(40 - x, 50, 30, KAKI), rect(100 - x, 0, 100, 100, INK), circle(150 - x, 50, 16, PALE)];
  },

  "key-light": (t) => {
    const a = t * Math.PI * 2;
    const at = `${pct(50 + 32 * Math.cos(a))} ${pct(50 + 32 * Math.sin(a))}`;
    return [circle(50, 50, 46, `radial-gradient(circle at ${at}, #FFF4E8 0%, #E8955F 28%, #5A2A12 72%, #241812 100%)`)];
  },

  "rim-light": (t) => {
    const a = t * Math.PI * 2;
    return [
      circle(50 + 1.8 * Math.cos(a), 50 + 2.4 * Math.sin(a), 44, "#FFD9B8", { opacity: 0.55 + 0.45 * pingPong(t), ...blur(2) }),
      circle(50, 50, 42, "#1E1A17"),
    ];
  },

  "color-temperature": (t) => {
    const f = inOut(pingPong(t));
    return [
      rect(0, 0, 100, 100, mix("#F2C3A0", "#9FB3D6", f)),
      circle(72, 30 - f * 6, 14, mix("#D9662A", "#F4F4F0", f)),
      rect(0, 74, 100, 26, mix("#B98A68", "#3B4558", f)),
      rect(30, 52, 8, 22, INK),
    ];
  },
};
