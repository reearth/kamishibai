// Generative: how each term's loop is drawn. See kit.ts.
import {
  INK, INK_2, PAPER, KAKI, KAKI_2, PALE, GREY, GREY_2, MIST, NIGHT, TAU, W, H,
  clamp, lerp, span, out, inOut, smooth, wrap, mix, rand, fill, dot,
  type Paint, type Shapes,
} from "./kit.ts";

export const SHAPES: Record<string, Shapes> = {};

/** A colour from the palette with an alpha. */
function rgba(hex: string, a: number): string {
  const ch = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  return `rgba(${ch(1)},${ch(3)},${ch(5)},${clamp(a).toFixed(3)})`;
}

// Value noise from a fixed table, cheaper than kit's noise() when a picture
// needs thousands of samples. The table is constant: the same on every call.
const N = 64;
const TABLE = Float32Array.from({ length: N * N }, (_, i) => rand(i % N, Math.floor(i / N), 41));
function vnoise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = smooth(x - xi), yf = smooth(y - yi);
  const x0 = xi & (N - 1), y0 = yi & (N - 1), x1 = (x0 + 1) & (N - 1), y1 = (y0 + 1) & (N - 1);
  const a = TABLE[y0 * N + x0]!, b = TABLE[y0 * N + x1]!;
  const c = TABLE[y1 * N + x0]!, d = TABLE[y1 * N + x1]!;
  return lerp(lerp(a, b, xf), lerp(c, d, xf), yf);
}

/** A small offscreen canvas, fully redrawn by each call that uses it. */
let scratch: HTMLCanvasElement | null = null;
function buffer(w: number, h: number): CanvasRenderingContext2D | null {
  scratch ??= document.createElement("canvas");
  if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w;
    scratch.height = h;
  }
  return scratch.getContext("2d");
}

/** Glow drawn as wide, faint strokes under a bright core. */
function glowLine(g: CanvasRenderingContext2D, pts: number[], layers: [number, string][]): void {
  for (const [w, color] of layers) {
    g.strokeStyle = color;
    g.lineWidth = w;
    g.beginPath();
    for (let i = 0; i < pts.length; i += 2) {
      if (i) g.lineTo(pts[i]!, pts[i + 1]!);
      else g.moveTo(pts[i]!, pts[i + 1]!);
    }
    g.stroke();
  }
}

/** A jagged path from a to b by midpoint displacement. Returns x, y pairs. */
function bolt(ax: number, ay: number, bx: number, by: number, seed: number, rough: number, levels: number): number[] {
  let pts = [ax, ay, bx, by];
  let d = rough;
  for (let l = 0; l < levels; l++) {
    const next: number[] = [];
    for (let i = 0; i < pts.length - 2; i += 2) {
      const x0 = pts[i]!, y0 = pts[i + 1]!, x1 = pts[i + 2]!, y1 = pts[i + 3]!;
      const len = Math.hypot(x1 - x0, y1 - y0) || 1;
      const off = (rand(seed, l, i) - 0.5) * d;
      next.push(x0, y0, (x0 + x1) / 2 - ((y1 - y0) / len) * off, (y0 + y1) / 2 + ((x1 - x0) / len) * off);
    }
    next.push(pts[pts.length - 2]!, pts[pts.length - 1]!);
    pts = next;
    d *= 0.55;
  }
  return pts;
}

// Shatter: a square cut into a jittered grid of triangles, fixed for every call.
const SH = 4, SQ = 150, SX = 125, SY = 75;
const SHARDS: { pts: [number, number][]; cx: number; cy: number; r: number }[] = (() => {
  const P = (i: number, j: number): [number, number] => {
    const jx = i > 0 && i < SH ? (rand(i, j, 1) - 0.5) * 22 : 0;
    const jy = j > 0 && j < SH ? (rand(i, j, 2) - 0.5) * 22 : 0;
    return [SX + (i * SQ) / SH + jx, SY + (j * SQ) / SH + jy];
  };
  const list: [number, number][][] = [];
  for (let i = 0; i < SH; i++)
    for (let j = 0; j < SH; j++) {
      const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
      if (rand(i, j, 3) < 0.5) list.push([a, b, c], [a, c, d]);
      else list.push([a, b, d], [b, c, d]);
    }
  return list.map((pts, k) => ({
    pts,
    cx: (pts[0]![0] + pts[1]![0] + pts[2]![0]) / 3,
    cy: (pts[0]![1] + pts[1]![1] + pts[2]![1]) / 3,
    r: rand(k, 7),
  }));
})();

export const PAINT: Record<string, Paint> = {
  particles: (g, t) => {
    const ex = 200, ey = 236, G = 560;
    g.globalCompositeOperation = "source-over";
    for (let i = 0; i < 110; i++) {
      // each particle lives 1/2 or 1/3 of the loop and is reborn at once
      const n = rand(i, 1) < 0.5 ? 2 : 3;
      const age = wrap(t * n + rand(i, 2), 1);
      const tau = age * 0.95;
      const ang = -Math.PI / 2 + (rand(i, 3) - 0.5) * 1.0;
      const v = 330 + 110 * rand(i, 4);
      const x = ex + Math.cos(ang) * v * tau;
      const y = ey + Math.sin(ang) * v * tau + 0.5 * G * tau * tau;
      const r = (1.6 + 4 * rand(i, 5)) * (1 - age * 0.7);
      const color = rand(i, 6) < 0.12 ? INK : mix(KAKI, PALE, age * 0.9);
      g.globalAlpha = clamp((1 - age) * 1.4) * clamp(age * 12);
      dot(g, x, y, r, color);
    }
    g.globalAlpha = 1;
    // the emitter
    g.fillStyle = INK;
    g.beginPath();
    g.moveTo(ex - 9, ey);
    g.lineTo(ex + 9, ey);
    g.lineTo(ex + 16, ey + 22);
    g.lineTo(ex - 16, ey + 22);
    g.closePath();
    g.fill();
    g.fillStyle = MIST;
    g.fillRect(60, ey + 22, 280, 3);
  },

  shatter: (g, t) => {
    // whole → cracks → burst → hang → come back together → whole
    const crack = span(t, 0.06, 0.14);
    const f = out(span(t, 0.14, 0.4)) * (1 - inOut(span(t, 0.56, 0.88)));
    const ix = 165, iy = 135; // the point of impact
    if (f < 0.01) {
      g.fillStyle = KAKI;
      g.fillRect(SX, SY, SQ, SQ);
      if (crack > 0 && t < 0.5) {
        g.strokeStyle = rgba(PAPER, 0.9 * crack);
        g.lineWidth = 1.4;
        g.lineJoin = "round";
        for (const s of SHARDS) {
          g.beginPath();
          s.pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y)));
          g.closePath();
          g.stroke();
        }
      }
      return;
    }
    for (const s of SHARDS) {
      const dx = s.cx - ix, dy = s.cy - iy;
      const d = Math.hypot(dx, dy) || 1;
      const dist = (26 + 54 * s.r) * (1.3 - Math.min(1, d / 200) * 0.6);
      const ox = (dx / d) * dist * f, oy = (dy / d) * dist * f + 14 * f * f;
      const rot = (s.r - 0.5) * 1.6 * f;
      g.save();
      g.translate(s.cx + ox, s.cy + oy);
      g.rotate(rot);
      g.translate(-s.cx, -s.cy);
      g.fillStyle = mix(KAKI, KAKI_2, s.r * 0.6 * clamp(f * 3));
      g.beginPath();
      s.pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.fill();
      g.restore();
    }
  },

  "fractal-noise": (g, t) => {
    const bw = 100, bh = 75;
    const b = buffer(bw, bh);
    if (!b) return;
    const img = b.createImageData(bw, bh);
    const d = img.data;
    // each octave slides round its own circle, so the cloud evolves and comes back
    // (each octave is turned a little too, so the lattice of the noise doesn't show)
    const oct = [0, 1, 2, 3].map((o) => {
      const s = 0.032 * 2 ** o, r = 0.4, ph = o * 1.7, dir = o % 2 ? -1 : 1, rot = 0.5 + o * 1.1;
      return {
        w: 0.5 ** o, xx: s * Math.cos(rot), xy: -s * Math.sin(rot), yx: s * Math.sin(rot), yy: s * Math.cos(rot),
        ox: r * Math.cos(dir * TAU * t + ph) + o * 9, oy: r * Math.sin(dir * TAU * t + ph) + o * 5,
      };
    });
    for (let y = 0; y < bh; y++)
      for (let x = 0; x < bw; x++) {
        let v = 0;
        for (const o of oct) v += o.w * vnoise(x * o.xx + y * o.xy + o.ox, x * o.yx + y * o.yy + o.oy);
        const c = smooth(clamp((v / 1.875 - 0.2) / 0.6));
        const i = (y * bw + x) * 4;
        d[i] = 30 + 225 * c;
        d[i + 1] = 26 + 225 * c;
        d[i + 2] = 23 + 222 * c;
        d[i + 3] = 255;
      }
    b.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.drawImage(b.canvas, 0, 0, W, H);
  },

  "flow-field": (g, t) => {
    const ca = 0.4 * Math.cos(TAU * t), sa = 0.4 * Math.sin(TAU * t);
    const angle = (x: number, y: number) => vnoise(x * 0.0075 + ca + 3, y * 0.0075 + sa + 3) * TAU * 1.6;
    const steps = 36, step = 4.5;
    g.lineCap = "round";
    g.lineJoin = "round";
    for (let i = 0; i < 110; i++) {
      let x = 10 + rand(i, 1) * 380, y = 10 + rand(i, 2) * 280;
      const pts: number[] = [x, y];
      for (let k = 0; k < steps; k++) {
        const a = angle(x, y);
        x += Math.cos(a) * step;
        y += Math.sin(a) * step;
        pts.push(x, y);
      }
      g.strokeStyle = rgba(INK_2, 0.32);
      g.lineWidth = 1.1;
      g.beginPath();
      for (let k = 0; k < pts.length; k += 2) (k ? g.lineTo(pts[k]!, pts[k + 1]!) : g.moveTo(pts[k]!, pts[k + 1]!));
      g.stroke();
      // a highlight running along the strand, twice a loop
      if (i % 3) continue;
      const head = Math.floor(wrap(t * 2 + rand(i, 3), 1) * (steps + 10));
      const from = Math.max(0, head - 9), to = Math.min(steps, head);
      if (to - from < 1) continue;
      g.strokeStyle = KAKI;
      g.lineWidth = 2.4;
      g.beginPath();
      for (let k = from; k <= to; k++) (k > from ? g.lineTo(pts[2 * k]!, pts[2 * k + 1]!) : g.moveTo(pts[2 * k]!, pts[2 * k + 1]!));
      g.stroke();
    }
  },

  lightning: (g, t) => {
    fill(g, NIGHT);
    const k = Math.floor(t * 26); // ~10 fps flicker
    const shape = Math.floor(t * 13); // a new bolt every 2 frames
    const ax = 62, ay = 150, bx = 338, by = 150;
    const flick = rand(k, 9);
    const bright = flick < 0.15 ? 0.3 : 0.65 + 0.35 * rand(k, 10);
    g.fillStyle = rgba(PALE, 0.07 * bright);
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = "lighter";
    g.lineJoin = "round";
    g.lineCap = "round";
    const main = bolt(ax, ay, bx, by, shape, 120, 7);
    const layers = (s: number): [number, string][] => [
      [22 * s, rgba(KAKI, 0.08 * bright)],
      [11 * s, rgba(KAKI_2, 0.2 * bright)],
      [4.5 * s, rgba(PALE, 0.55 * bright)],
      [1.8 * s, rgba("#FFF8F0", bright)],
    ];
    glowLine(g, main, layers(1));
    // branches off the main bolt
    for (let j = 0; j < 3; j++) {
      const at = 2 * Math.floor((0.2 + 0.6 * rand(shape, j, 1)) * (main.length / 2));
      const sx = main[at]!, sy = main[at + 1]!;
      const dir = rand(shape, j, 2) < 0.5 ? -1 : 1;
      const len = 50 + 50 * rand(shape, j, 3);
      const br = bolt(sx, sy, sx + len * 0.8, sy + dir * len * 0.7, shape * 7 + j, 40, 5);
      glowLine(g, br, layers(0.55));
    }
    g.globalCompositeOperation = "source-over";
    // the terminals
    for (const x of [ax, bx]) {
      dot(g, x, ay, 11, INK_2);
      dot(g, x, ay, 6, KAKI);
    }
  },

  "audio-spectrum": (g, t) => {
    const n = 28, x0 = 40, bw = 9, gap = (320 - n * bw) / (n - 1), base = 236;
    const kick = (u: number) => Math.exp(-wrap(u * 4, 1) * 6);
    const snare = (u: number) => Math.exp(-wrap(u * 2 + 0.5, 1) * 8);
    const hat = (u: number) => Math.exp(-wrap(u * 8 + 0.5, 1) * 12);
    const level = (i: number, u: number) => {
      const f = i / (n - 1);
      const tone = 0.5 + 0.5 * Math.sin(TAU * (u * (2 + (i % 4)) + rand(i, 1)));
      return clamp(
        0.04 + 0.12 * (1 - f) +
        0.8 * kick(u) * Math.pow(1 - f, 3) +
        0.45 * snare(u) * Math.exp(-((f - 0.45) ** 2) / 0.02) * (0.7 + 0.3 * rand(i, 3)) +
        0.35 * hat(u) * Math.pow(f, 1.6) * (0.6 + 0.4 * rand(i, 4)) +
        0.2 * tone * (0.4 + 0.6 * rand(i, 2)),
      );
    };
    g.fillStyle = GREY;
    g.fillRect(x0 - 8, base + 4, 320 + 16, 1.5);
    for (let i = 0; i < n; i++) {
      const v = level(i, t);
      const h = 6 + 170 * v;
      const x = x0 + i * (bw + gap);
      g.fillStyle = INK;
      g.fillRect(x, base - h, bw, h);
      // the peak cap: the highest recent level, falling slowly
      let peak = v;
      for (let j = 1; j <= 14; j++) peak = Math.max(peak, level(i, wrap(t - j * 0.012, 1)) - j * 0.022);
      g.fillStyle = KAKI;
      g.fillRect(x, base - 6 - 170 * peak - 6.5, bw, 3.5);
    }
  },

  plexus: (g, t) => {
    const pts: [number, number][] = [];
    for (let i = 0; i < 38; i++) {
      const s1 = rand(i, 3) < 0.5 ? 1 : -1, s2 = rand(i, 4) < 0.5 ? 1 : -1;
      pts.push([
        30 + rand(i, 1) * 340 + 26 * Math.cos(s1 * TAU * t + rand(i, 5) * TAU),
        30 + rand(i, 2) * 240 + 20 * Math.sin(s2 * TAU * t + rand(i, 6) * TAU),
      ]);
    }
    const R = 92;
    g.lineWidth = 1.1;
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++) {
        const [ax, ay] = pts[i]!, [bx, by] = pts[j]!;
        const d = Math.hypot(ax - bx, ay - by);
        if (d >= R) continue;
        g.strokeStyle = rgba(INK_2, 0.75 * (1 - d / R) ** 1.3);
        g.beginPath();
        g.moveTo(ax, ay);
        g.lineTo(bx, by);
        g.stroke();
      }
    pts.forEach(([x, y], i) => dot(g, x, y, i % 9 === 0 ? 4.2 : 2.6, i % 9 === 0 ? KAKI : INK));
  },

  "card-dance": (g, t) => {
    const cols = 8, rows = 6, cs = 40, gap = 3;
    const gw = cols * cs + (cols - 1) * gap, gh = rows * cs + (rows - 1) * gap;
    const gx = (W - gw) / 2, gy = (H - gh) / 2;
    // the two pictures the cards carry, front and back
    const front = () => {
      g.fillStyle = KAKI;
      g.fillRect(gx, gy, gw, gh);
      dot(g, W / 2, H / 2, 78, PAPER);
    };
    const back = () => {
      g.fillStyle = INK;
      g.fillRect(gx, gy, gw, gh);
      g.fillStyle = KAKI;
      g.beginPath();
      g.moveTo(W / 2 - 52, H / 2 - 74);
      g.lineTo(W / 2 + 82, H / 2);
      g.lineTo(W / 2 - 52, H / 2 + 74);
      g.closePath();
      g.fill();
    };
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const delay = ((c + r) / (cols + rows - 2)) * 0.26;
        const p = inOut(span(t, 0.06 + delay, 0.24 + delay)) + inOut(span(t, 0.54 + delay, 0.72 + delay));
        const th = Math.PI * p;
        const sx = Math.cos(th);
        const x = gx + c * (cs + gap), y = gy + r * (cs + gap);
        const mx = x + cs / 2, my = y + cs / 2;
        const lift = 1 + 0.12 * Math.sin(th) ** 2;
        g.save();
        g.translate(mx, my);
        g.scale(Math.max(0.001, Math.abs(sx)) * lift, lift);
        g.translate(-mx, -my);
        g.beginPath();
        g.rect(x, y, cs, cs);
        g.clip();
        if (p < 0.5 || p >= 1.5) front();
        else back();
        // darker as the card turns edge-on
        g.fillStyle = rgba(INK, 0.45 * (1 - Math.abs(sx)));
        g.fillRect(x, y, cs, cs);
        g.restore();
      }
  },

  scribble: (g, t) => {
    const k = Math.floor(t * 13); // a new drawing every other frame at ~10 fps
    const cx = 200 + (rand(k, 1) - 0.5) * 3, cy = 150 + (rand(k, 2) - 0.5) * 3, r = 92;
    const a = -0.75 + (rand(k, 3) - 0.5) * 0.3;
    const ux = Math.cos(a), uy = Math.sin(a); // along the hatch
    const nx = -uy, ny = ux; // across it
    const sp = 7.5;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.strokeStyle = KAKI;
    g.lineWidth = 2.6;
    g.beginPath();
    let first = true;
    for (let j = 0, s = -r + 4; s < r - 2; j++, s += sp + (rand(k, j, 4) - 0.5) * 3) {
      const half = Math.sqrt(Math.max(0, r * r - s * s));
      const e = j % 2 ? 1 : -1;
      const reach = half + (rand(k, j, 5) - 0.6) * 12;
      const x = cx + nx * s + ux * e * reach, y = cy + ny * s + uy * e * reach;
      if (first) g.moveTo(x, y);
      else {
        const bend = (rand(k, j, 8) - 0.5) * 7;
        g.quadraticCurveTo(cx + nx * (s - sp / 2 + bend), cy + ny * (s - sp / 2 + bend), x, y);
      }
      first = false;
    }
    g.stroke();
    // a wobbly outline, drawn round a little more than once
    g.strokeStyle = INK;
    g.lineWidth = 3;
    g.beginPath();
    const m = 44;
    const start = rand(k, 6) * TAU;
    for (let i = 0; i <= m + 5; i++) {
      const an = start + (i / m) * TAU;
      const rr = r + 3 + (rand(k, i % m, 7) - 0.5) * 4 + (i > m ? (i - m) * 1.2 : 0);
      const x = cx + rr * Math.cos(an), y = cy + rr * Math.sin(an);
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.stroke();
  },
};
