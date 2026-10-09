// Type: how each term's loop is drawn. See kit.ts.
import {
  INK, INK_2, KAKI, PALE, GREY, GREY_2, MIST, TAU,
  clamp, lerp, span, inOut, out, inCubic, rand, dot, font,
  type Paint, type Shapes,
} from "./kit.ts";

export const SHAPES: Record<string, Shapes> = {};

/** Overshoots a little past 1, then settles. */
const outBack = (p: number, s = 1.70158) => 1 + (s + 1) * Math.pow(p - 1, 3) + s * Math.pow(p - 1, 2);
/** A fast start that glides into place. */
const outExpo = (p: number) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p));

/** Where each character starts, measured as prefixes so kerning is kept. */
function offsets(g: CanvasRenderingContext2D, s: string): number[] {
  const xs: number[] = [];
  for (let i = 0; i <= s.length; i++) xs.push(g.measureText(s.slice(0, i)).width);
  return xs;
}

// ---- write-on: a cursive "hello" as a Catmull-Rom spline through hand-placed points ----
const HELLO: [number, number][] = [
  [62, 196], [82, 182], [104, 150], [120, 106], [120, 76], [106, 70], [96, 92], [93, 140], [92, 196],
  [96, 170], [110, 150], [126, 152], [130, 176], [134, 196], [150, 198],
  [170, 180], [184, 160], [176, 146], [160, 156], [158, 182], [172, 198], [194, 194],
  [212, 160], [228, 108], [226, 76], [212, 74], [204, 104], [206, 160], [214, 194], [232, 196],
  [252, 160], [266, 108], [264, 76], [250, 74], [242, 104], [244, 160], [252, 194], [270, 196],
  [288, 176], [294, 156], [312, 150], [326, 166], [322, 188], [306, 198], [292, 186], [296, 164], [314, 154], [334, 150], [350, 146],
];
const PEN = (() => {
  const pts: [number, number][] = [];
  const P = (i: number) => HELLO[Math.max(0, Math.min(HELLO.length - 1, i))]!;
  for (let i = 0; i < HELLO.length - 1; i++) {
    const [p0, p1, p2, p3] = [P(i - 1), P(i), P(i + 1), P(i + 2)];
    for (let k = 0; k < 12; k++) {
      const u = k / 12, u2 = u * u, u3 = u2 * u;
      const c = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
      pts.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  pts.push(HELLO[HELLO.length - 1]!);
  const len = [0];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    len.push(len[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return { pts, len, total: len[len.length - 1]! };
})();

/** The point at arc length s along PEN. */
function penAt(s: number): [number, number] {
  const { pts, len } = PEN;
  let i = 1;
  while (i < len.length - 1 && len[i]! < s) i++;
  const a = pts[i - 1]!, b = pts[i]!;
  const f = clamp((s - len[i - 1]!) / Math.max(1e-6, len[i]! - len[i - 1]!));
  return [lerp(a[0], b[0], f), lerp(a[1], b[1], f)];
}

// ---- text on a path: one wave across the frame, tabled by arc length ----
const WAVE = (() => {
  const y = (x: number) => 162 + 36 * Math.sin(((x - 10) / 400) * TAU);
  const pts: [number, number][] = [];
  for (let x = -60; x <= 460; x += 2) pts.push([x, y(x)]);
  const len = [0];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    len.push(len[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return { pts, len, total: len[len.length - 1]! };
})();

function waveAt(s: number): { x: number; y: number; a: number } {
  const { pts, len } = WAVE;
  // the table is evenly spaced in x, so start from a good guess
  let i = Math.max(1, Math.min(len.length - 1, Math.floor((s / WAVE.total) * len.length)));
  while (i > 1 && len[i - 1]! > s) i--;
  while (i < len.length - 1 && len[i]! < s) i++;
  const a = pts[i - 1]!, b = pts[i]!;
  const f = clamp((s - len[i - 1]!) / Math.max(1e-6, len[i]! - len[i - 1]!));
  return { x: lerp(a[0], b[0], f), y: lerp(a[1], b[1], f), a: Math.atan2(b[1] - a[1], b[0] - a[0]) };
}

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+=?<>/";

export const PAINT: Record<string, Paint> = {
  "kinetic-typography": (g, t) => {
    const B = 280, x0 = 60;
    const beats = [0.06, 0.22, 0.38];
    // a little camera punch on every beat
    let punch = 0;
    for (const b of beats) if (t >= b) punch += 0.035 * Math.exp(-(t - b) / 0.03);
    g.translate(200, 150);
    g.scale(1 + punch, 1 + punch);
    g.translate(-200, -150);
    const words = [
      { s: "WRITE", px: 66, wt: 800, c: INK, y: 116, align: "left" },
      { s: "WATCH", px: 34, wt: 700, c: INK_2, y: 160, align: "right" },
      { s: "RENDER.", px: 90, wt: 800, c: KAKI, y: 236, align: "fit" },
    ];
    words.forEach((w, i) => {
      const p = span(t, beats[i]!, beats[i]! + 0.08);
      if (p <= 0) return;
      const e = span(t, 0.84 + i * 0.025, 0.92 + i * 0.025);
      if (e >= 1) return;
      font(g, w.px, w.wt);
      let width = g.measureText(w.s).width;
      let px = w.px;
      if (w.align === "fit") {
        px = (w.px * B) / width;
        font(g, px, w.wt);
        width = B;
      }
      const x = w.align === "right" ? x0 + B - width : x0;
      const s = lerp(1.6, 1, outBack(p, 2.2)) * (1 - 0.15 * inCubic(e));
      const cx = x + width / 2, cy = w.y - px * 0.36;
      g.save();
      g.globalAlpha = clamp(p * 4) * (1 - e);
      g.translate(cx, cy - 18 * inCubic(e));
      g.scale(s, s);
      g.fillStyle = w.c;
      g.textBaseline = "alphabetic";
      g.fillText(w.s, x - cx, w.y - cy);
      g.restore();
    });
  },

  typewriter: (g, t) => {
    const text = "Hello, world.";
    font(g, 44, 500);
    const xs = offsets(g, text);
    const x0 = 200 - xs[text.length]! / 2, base = 166;
    // when each character lands: an uneven human rhythm, with a pause after the comma
    const at: number[] = [];
    let c = 0.08;
    for (let i = 0; i < text.length; i++) {
      at.push(c);
      c += 0.03 * (0.6 + 0.8 * rand(i, 7)) + (text[i] === "," ? 0.06 : 0);
    }
    const typed = at.filter((a) => t >= a).length;
    // then delete back, faster than it was typed
    const del = Math.floor(clamp((t - 0.84) / 0.1) * text.length + (t >= 0.84 ? 1 : 0));
    const n = Math.max(0, Math.min(typed, text.length - (t >= 0.84 ? del : 0)));
    g.fillStyle = INK;
    g.fillText(text.slice(0, n), x0, base);
    const holding = t > at[text.length - 1]! + 0.04 && t < 0.84;
    const on = !holding || Math.floor((t - 0.6) / 0.1) % 2 === 0;
    if (on) {
      g.fillStyle = KAKI;
      g.fillRect(x0 + xs[n]! + 3, base - 36, 4, 46);
    }
  },

  "per-character-animation": (g, t) => {
    const text = "MOTION";
    font(g, 88, 800);
    const xs = offsets(g, text);
    const x0 = 200 - xs[text.length]! / 2, base = 184;
    g.fillStyle = MIST;
    g.fillRect(40, base + 14, 320, 2);
    for (let k = 0; k < text.length; k++) {
      const a = 0.06 + k * 0.05;
      const p = span(t, a, a + 0.22);
      if (p <= 0) continue;
      const q = span(t, 0.7 + k * 0.025, 0.83 + k * 0.025);
      if (q >= 1) continue;
      const e = outBack(p, 1.4);
      const cw = xs[k + 1]! - xs[k]!;
      g.save();
      g.globalAlpha = clamp(p * 2.5) * (1 - q);
      g.translate(x0 + xs[k]! + cw / 2, base - 52 * (1 - e) - 34 * inCubic(q));
      g.rotate(0.35 * (1 - out(p)));
      g.fillStyle = INK;
      g.fillText(text[k]!, -cw / 2, 0);
      g.restore();
    }
  },

  "mask-reveal": (g, t) => {
    const lines = ["Write,", "watch,", "render."];
    font(g, 58, 800);
    const x0 = 72, lh = 64, top = 104;
    lines.forEach((s, i) => {
      const base = top + i * lh;
      const p = outExpo(span(t, 0.06 + i * 0.08, 0.36 + i * 0.08));
      const q = inCubic(span(t, 0.72 + i * 0.045, 0.86 + i * 0.045));
      if (p <= 0 || q >= 1) return;
      const dy = (1 - p) * lh - q * lh;
      g.save();
      g.beginPath();
      g.rect(0, base - 50, 400, 68);
      g.clip();
      g.fillStyle = i === 2 ? KAKI : INK;
      g.fillText(s, x0, base + dy);
      g.restore();
    });
  },

  "text-scramble": (g, t) => {
    const word = "KAMISHIBAI";
    const cw = 30, x0 = 200 - (word.length * cw) / 2, base = 166;
    const step = Math.floor(t * 39);
    font(g, 40, 800);
    g.textAlign = "center";
    for (let i = 0; i < word.length; i++) {
      const cx = x0 + i * cw + cw / 2;
      g.fillStyle = MIST;
      g.fillRect(cx - 10, base + 14, 20, 3);
      const appear = 0.04 + i * 0.022, resolve = 0.2 + i * 0.04;
      const o = 0.74 + (word.length - 1 - i) * 0.014, gone = o + 0.09;
      if (t < appear || t >= gone) continue;
      if (t >= resolve && t < o) {
        g.fillStyle = INK;
        g.fillText(word[i]!, cx, base);
      } else {
        const r = rand(i, step);
        g.fillStyle = rand(i, step, 3) < 0.3 ? KAKI : GREY_2;
        g.fillText(GLYPHS[Math.floor(r * GLYPHS.length)]!, cx, base);
      }
    }
  },

  tracking: (g, t) => {
    const text = "HORIZON";
    const px = 42;
    font(g, px, 800);
    const xs = offsets(g, text);
    const f = inOut(span(t, 0.08, 0.46)) - inOut(span(t, 0.58, 0.96));
    const s = f * 26;
    const width = xs[text.length]! + s * (text.length - 1);
    const x0 = 200 - width / 2, base = 166;
    // the added space, shown as the type tool shows it
    g.fillStyle = PALE;
    g.globalAlpha = clamp(f * 3) * 0.7;
    for (let k = 0; k < text.length - 1; k++) g.fillRect(x0 + xs[k + 1]! + s * k, base - px * 0.72, s, px * 0.72);
    g.globalAlpha = 1;
    g.fillStyle = INK;
    for (let k = 0; k < text.length; k++) g.fillText(text[k]!, x0 + xs[k]! + s * k, base);
    font(g, 14, 500);
    g.textAlign = "center";
    g.fillStyle = GREY_2;
    g.fillText(`tracking  ${s > 0.5 ? "+" : ""}${Math.round((s / px) * 1000)}`, 200, 212);
  },

  "write-on": (g, t) => {
    const head = PEN.total * inOut(span(t, 0.05, 0.62));
    const tail = PEN.total * inOut(span(t, 0.76, 0.96));
    g.fillStyle = MIST;
    g.fillRect(52, 197, 300, 2);
    if (head - tail > 0.5) {
      g.strokeStyle = INK;
      g.lineWidth = 8;
      g.lineCap = "round";
      g.lineJoin = "round";
      g.beginPath();
      const { pts, len } = PEN;
      const a = penAt(tail);
      g.moveTo(a[0], a[1]);
      for (let i = 0; i < pts.length; i++) {
        if (len[i]! <= tail) continue;
        if (len[i]! >= head) break;
        g.lineTo(pts[i]![0], pts[i]![1]);
      }
      const b = penAt(head);
      g.lineTo(b[0], b[1]);
      g.stroke();
    }
    const writing = t > 0.05 && t < 0.62;
    if (writing) {
      const b = penAt(head);
      dot(g, b[0], b[1], 7, KAKI);
    }
  },

  "text-on-a-path": (g, t) => {
    g.strokeStyle = GREY;
    g.lineWidth = 1.5;
    g.setLineDash([4, 5]);
    g.beginPath();
    WAVE.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
    g.setLineDash([]);
    const unit = "kamishibai • ";
    font(g, 26, 700);
    const xs = offsets(g, unit);
    const U = xs[unit.length]!;
    const o = t * U;
    g.textBaseline = "alphabetic";
    for (let k = -1; k * U < WAVE.total + U; k++) {
      for (let j = 0; j < unit.length; j++) {
        const ch = unit[j]!;
        if (ch === " ") continue;
        const cw = xs[j + 1]! - xs[j]!;
        const s = k * U + xs[j]! + cw / 2 + o;
        if (s < 0 || s > WAVE.total) continue;
        const p = waveAt(s);
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.a);
        g.fillStyle = ch === "•" ? KAKI : INK;
        g.fillText(ch, -cw / 2, -6);
        g.restore();
      }
    }
  },

  "variable-font": (g, t) => {
    const f = inOut(span(t, 0.06, 0.44)) - inOut(span(t, 0.56, 0.94));
    // 200 → 900 and back. Only a few weights are loaded, so the axis is faked from
    // the 400: eroded with a cut-out stroke below it, thickened with a stroke above.
    const wt = lerp(200, 900, f);
    const text = "Weight";
    const px = 84;
    font(g, px, 400);
    const xs = offsets(g, text);
    const thick = wt > 400 ? ((wt - 400) / 500) * 7 : 0;
    const thin = wt < 400 ? ((400 - wt) / 200) * 3.4 : 0;
    const gap = thick * 0.55 - thin * 0.3;
    const width = xs[text.length]! + gap * (text.length - 1);
    const x0 = 200 - width / 2, base = 158;
    g.lineJoin = "round";
    for (let k = 0; k < text.length; k++) {
      const x = x0 + xs[k]! + gap * k;
      g.fillStyle = INK;
      g.fillText(text[k]!, x, base);
      if (thick > 0) {
        g.strokeStyle = INK;
        g.lineWidth = thick;
        g.strokeText(text[k]!, x, base);
      }
    }
    if (thin > 0) {
      g.globalCompositeOperation = "destination-out";
      g.strokeStyle = INK;
      g.lineWidth = thin;
      for (let k = 0; k < text.length; k++) g.strokeText(text[k]!, x0 + xs[k]! + gap * k, base);
      g.globalCompositeOperation = "source-over";
    }
    // the axis, as a slider
    const a = 110, b = 290, y = 214;
    g.fillStyle = GREY;
    g.fillRect(a, y - 1, b - a, 2);
    const kx = lerp(a, b, (wt - 200) / 700);
    g.fillStyle = KAKI;
    g.fillRect(a, y - 1, kx - a, 2);
    dot(g, kx, y, 7, KAKI);
    font(g, 13, 500);
    g.fillStyle = GREY_2;
    g.textAlign = "right";
    g.fillText("wght", a - 12, y + 4.5);
    g.textAlign = "left";
    g.fillText(String(Math.round(wt / 10) * 10), b + 12, y + 4.5);
  },

  "count-up": (g, t) => {
    const target = 1280;
    const v = t < 0.8 ? target * out(span(t, 0.06, 0.6)) : target * (1 - inOut(span(t, 0.82, 0.96)));
    const px = 96, base = 162;
    font(g, px, 800);
    let cw = 0;
    for (let d = 0; d < 10; d++) cw = Math.max(cw, g.measureText(String(d)).width);
    const comma = g.measureText(",").width;
    const width = cw * 4 + comma;
    const x0 = 200 - width / 2;
    const lh = px * 1.2, top = base - px * 0.96, bot = base + px * 0.22;
    g.save();
    g.beginPath();
    g.rect(x0 - 10, top, width + 20, bot - top);
    g.clip();
    g.textAlign = "center";
    for (let i = 0; i < 4; i++) {
      const p = Math.pow(10, i);
      const whole = Math.floor(v / p);
      // a digit sits still, then rolls over in the last part of each step, carrying like an odometer
      const frac = inOut(clamp(((v % p) - (p - 1) - 0.5) / 0.5));
      const col = 3 - i;
      const cx = x0 + col * cw + (col >= 1 ? comma : 0) + cw / 2;
      for (const [n, dy] of [[whole, -frac * lh], [whole + 1, (1 - frac) * lh]] as const) {
        if (dy >= lh) continue;
        const lead = i > 0 && n === 0;
        g.fillStyle = lead ? GREY : INK;
        g.fillText(String(n % 10), cx, base + dy);
      }
    }
    g.textAlign = "left";
    g.fillStyle = v >= 999 ? INK : GREY;
    g.fillText(",", x0 + cw, base);
    g.restore();
    // soft edges on the window
    g.globalCompositeOperation = "destination-out";
    for (const [y0, y1] of [[top, top + 16], [bot, bot - 16]] as const) {
      const gr = g.createLinearGradient(0, y0, 0, y1);
      gr.addColorStop(0, "rgba(0,0,0,1)");
      gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr;
      g.fillRect(x0 - 10, Math.min(y0, y1), width + 20, Math.abs(y1 - y0));
    }
    g.globalCompositeOperation = "source-over";
    g.fillStyle = KAKI;
    g.fillRect(x0, bot + 6, width * (v / target), 4);
    font(g, 15, 500);
    g.fillStyle = GREY_2;
    g.fillText("frames", x0, bot + 34);
  },
};
