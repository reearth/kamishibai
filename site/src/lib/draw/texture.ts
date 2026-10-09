// Texture: how each term's loop is drawn. See kit.ts.
//
// Most of these are pixel treatments. The subject is drawn into a small
// offscreen canvas, treated there on a coarse grid, then drawn back scaled.
// Offscreen canvases are scratch buffers: either fully redrawn on every call,
// or filled once with a picture that never changes (`once`).
import {
  W, H, TAU, INK, INK_2, PAPER, KAKI, KAKI_2, PALE, GREY, MIST, NIGHT,
  clamp, lerp, span, out, inCubic, smooth, rand, noise, mix, fill, dot, font,
  type Paint, type Shapes,
} from "./kit.ts";

export const SHAPES: Record<string, Shapes> = {};

// ---- scratch canvases ----
type Ctx = CanvasRenderingContext2D;
interface Buf { c: HTMLCanvasElement; g: Ctx }

const bufs = new Map<string, Buf>();
function buf(key: string, w: number, h: number): Buf {
  let b = bufs.get(key);
  if (!b) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true });
    if (!g) throw new Error("2d canvas unavailable");
    b = { c, g };
    bufs.set(key, b);
  }
  return b;
}

/** Make the buffer's units the frame's (W × H), whatever its pixel size. */
function units(b: Buf): Ctx {
  b.g.setTransform(b.c.width / W, 0, 0, b.c.height / H, 0, 0);
  return b.g;
}

const made = new Set<string>();
/** A buffer holding a picture that never changes: drawn the first time it is asked for. */
function once(key: string, w: number, h: number, make: (b: Buf) => void): HTMLCanvasElement {
  const b = buf(key, w, h);
  if (!made.has(key)) {
    make(b);
    made.add(key);
  }
  return b.c;
}

/** A seeded generator for filling many pixels quickly (mulberry32). */
function prng(seed: number): () => number {
  let a = Math.floor(seed) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** 0, rising over a → b, held at 1, falling over c → d, 0 again. */
const env = (t: number, a: number, b: number, c: number, d: number) =>
  smooth(span(t, a, b)) * (1 - smooth(span(t, c, d)));

/** The loop's frame on a ~10 fps clock, for treatments that change "every frame". */
const step = (t: number, n = 26) => Math.floor(t * n);

const hex = (s: string): [number, number, number] =>
  [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];

/** The common subject: an orange sun going down behind an ink slab. */
function still(g: Ctx): void {
  dot(g, 200, 136, 78, KAKI);
  g.fillStyle = INK;
  g.fillRect(70, 196, 260, 34);
  g.fillRect(118, 244, 164, 12);
}

// ---- film grain ----
function grain(s: number): HTMLCanvasElement {
  return once(`grain${s}`, 266, 200, (b) => {
    const img = b.g.createImageData(266, 200);
    const r = prng(s * 7919 + 17);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = r() + r() + r() - 1.5;
      const c = v > 0 ? 255 : 0;
      d[i] = c;
      d[i + 1] = c;
      d[i + 2] = c;
      d[i + 3] = Math.min(255, Math.abs(v) * 120);
    }
    b.g.putImageData(img, 0, 0);
  });
}

// ---- grunge ----
const GW = 240, GH = 180;
let grungeField: Float32Array | null = null;
function field(): Float32Array {
  if (grungeField) return grungeField;
  const f = new Float32Array(GW * GH);
  const r = prng(4242);
  for (let y = 0; y < GH; y++)
    for (let x = 0; x < GW; x++) {
      const coarse = noise(x / 22, y / 22, 3) * 0.6 + noise(x / 8, y / 8, 4) * 0.3 + noise(x / 3, y / 3, 5) * 0.1;
      f[y * GW + x] = coarse * 0.62 + r() * 0.38;
    }
  return (grungeField = f);
}

// ---- halftone ----
/** The picture's colours sampled once per halftone cell. */
let halftonePx: Uint8ClampedArray | null = null;

// ---- duotone ----
function duotoneScene(g: Ctx): void {
  const sky = g.createLinearGradient(0, 0, 0, 210);
  sky.addColorStop(0, KAKI_2);
  sky.addColorStop(1, PALE);
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  dot(g, 268, 112, 44, "#FFF8F0");
  g.fillStyle = "#6E6E69";
  g.beginPath();
  g.moveTo(0, 196);
  g.bezierCurveTo(90, 150, 170, 170, 240, 190);
  g.bezierCurveTo(300, 206, 350, 170, 400, 176);
  g.lineTo(400, 300);
  g.lineTo(0, 300);
  g.fill();
  g.fillStyle = INK_2;
  g.beginPath();
  g.moveTo(0, 244);
  g.bezierCurveTo(120, 206, 250, 226, 400, 214);
  g.lineTo(400, 300);
  g.lineTo(0, 300);
  g.fill();
  // a figure on the near hill
  g.fillStyle = INK;
  dot(g, 112, 168, 10, INK);
  g.beginPath();
  g.moveTo(98, 232);
  g.quadraticCurveTo(112, 174, 126, 232);
  g.fill();
}

function duotone(key: string, dark: string, light: string): HTMLCanvasElement {
  return once(`duo-${key}`, 400, 300, (b) => {
    duotoneScene(units(b));
    if (!dark) return;
    const img = b.g.getImageData(0, 0, 400, 300);
    const d = img.data;
    const [r0, g0, b0] = hex(dark), [r1, g1, b1] = hex(light);
    for (let i = 0; i < d.length; i += 4) {
      const l = Math.pow(clamp((((d[i] ?? 0) * 0.3 + (d[i + 1] ?? 0) * 0.59 + (d[i + 2] ?? 0) * 0.11) / 255 - 0.06) / 0.9), 1.3);
      d[i] = r0 + (r1 - r0) * l;
      d[i + 1] = g0 + (g1 - g0) * l;
      d[i + 2] = b0 + (b1 - b0) * l;
    }
    b.g.putImageData(img, 0, 0);
  });
}

// ---- posterize ----
const RAMP = [hex("#2A140A"), hex("#7A3414"), hex(KAKI), hex(KAKI_2), hex("#FFF2E6")];
function ramp(v: number): [number, number, number] {
  const x = clamp(v) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  const f = x - i;
  const a = RAMP[i] ?? [0, 0, 0], b = RAMP[i + 1] ?? [0, 0, 0];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

function posterized(levels: number): HTMLCanvasElement {
  return once(`poster${levels}`, 400, 300, (b) => {
    const img = b.g.createImageData(400, 300);
    const d = img.data;
    const q = (v: number) => (levels ? Math.round(clamp(v) * (levels - 1)) / (levels - 1) : v);
    const L = [-0.55, -0.62, 0.56];
    const cx = 200, cy = 146, R = 104;
    for (let y = 0; y < 300; y++)
      for (let x = 0; x < 400; x++) {
        const i = (y * 400 + x) * 4;
        // the ground: light at the top, greyer at the foot
        const bv = q(1 - 0.55 * (y / 300));
        const bg = [lerp(146, 250, bv), lerp(150, 249, bv), lerp(158, 246, bv)];
        const nx = (x + 0.5 - cx) / R, ny = (y + 0.5 - cy) / R;
        const rr = nx * nx + ny * ny;
        const cover = clamp((1 - Math.sqrt(rr)) * R + 0.5);
        let fg = bg;
        if (cover > 0) {
          const nz = Math.sqrt(Math.max(0, 1 - rr));
          const lam = Math.max(0, nx * (L[0] ?? 0) + ny * (L[1] ?? 0) + nz * (L[2] ?? 0));
          fg = ramp(q(0.08 + 0.92 * Math.pow(lam, 1.3)));
        }
        d[i] = lerp(bg[0] ?? 0, fg[0] ?? 0, cover);
        d[i + 1] = lerp(bg[1] ?? 0, fg[1] ?? 0, cover);
        d[i + 2] = lerp(bg[2] ?? 0, fg[2] ?? 0, cover);
        d[i + 3] = 255;
      }
    b.g.putImageData(img, 0, 0);
  });
}

// ---- line boil ----
type Pt = [number, number];
function circlePts(cx: number, cy: number, r: number, n: number): Pt[] {
  return Array.from({ length: n }, (_, i) => [cx + r * Math.cos((TAU * i) / n), cy + r * Math.sin((TAU * i) / n)] as Pt);
}
function polyPts(corners: Pt[], per: number): Pt[] {
  const pts: Pt[] = [];
  corners.forEach((a, i) => {
    const b = corners[(i + 1) % corners.length] ?? a;
    for (let k = 0; k < per; k++) pts.push([lerp(a[0], b[0], k / per), lerp(a[1], b[1], k / per)]);
  });
  return pts;
}
/** A closed hand-drawn line through pts, each point nudged by a seeded wobble. */
function wobblePath(g: Ctx, pts: Pt[], seed: number[], amp: number): void {
  const p = pts.map(([x, y], i): Pt => [
    x + (rand(...seed, i, 1) - 0.5) * amp,
    y + (rand(...seed, i, 2) - 0.5) * amp,
  ]);
  const n = p.length;
  const mid = (i: number): Pt => {
    const a = p[i % n] ?? [0, 0], b = p[(i + 1) % n] ?? [0, 0];
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  };
  g.beginPath();
  const m0 = mid(0);
  g.moveTo(m0[0], m0[1]);
  for (let i = 1; i <= n; i++) {
    const c = p[i % n] ?? [0, 0], m = mid(i);
    g.quadraticCurveTo(c[0], c[1], m[0], m[1]);
  }
  g.closePath();
}

// ---- find edges ----
function edgeScene(g: Ctx): void {
  g.fillStyle = PAPER;
  g.fillRect(0, 0, W, H);
  still(g);
  dot(g, 200, 136, 34, KAKI_2);
  g.fillStyle = GREY;
  g.fillRect(70, 62, 40, 40);
  g.fillRect(296, 70, 30, 30);
}

function edges(): HTMLCanvasElement {
  return once("edges", 200, 150, (b) => {
    edgeScene(units(b));
    const src = b.g.getImageData(0, 0, 200, 150).data;
    const img = b.g.createImageData(200, 150);
    const d = img.data;
    const at = (x: number, y: number, c: number) =>
      src[((Math.min(149, Math.max(0, y)) * 200 + Math.min(199, Math.max(0, x))) * 4) + c] ?? 255;
    const lum = (x: number, y: number) => at(x, y, 0) * 0.3 + at(x, y, 1) * 0.59 + at(x, y, 2) * 0.11;
    for (let y = 0; y < 150; y++)
      for (let x = 0; x < 200; x++) {
        const i = (y * 200 + x) * 4;
        // the strongest channel edge sets how dark the line is…
        let m = 0;
        for (let c = 0; c < 3; c++) {
          const gx = at(x + 1, y - 1, c) + 2 * at(x + 1, y, c) + at(x + 1, y + 1, c) - at(x - 1, y - 1, c) - 2 * at(x - 1, y, c) - at(x - 1, y + 1, c);
          const gy = at(x - 1, y + 1, c) + 2 * at(x, y + 1, c) + at(x + 1, y + 1, c) - at(x - 1, y - 1, c) - 2 * at(x, y - 1, c) - at(x + 1, y - 1, c);
          m = Math.max(m, Math.hypot(gx, gy));
        }
        // …and the darker side of the edge gives its colour
        let dx = x, dy = y, dl = lum(x, y);
        for (let oy = -1; oy <= 1; oy++)
          for (let ox = -1; ox <= 1; ox++) {
            const l = lum(x + ox, y + oy);
            if (l < dl) [dl, dx, dy] = [l, x + ox, y + oy];
          }
        const f = clamp((m / 4 / 255) * 2.2);
        for (let c = 0; c < 3; c++) d[i + c] = 255 + (at(dx, dy, c) - 255) * f;
        d[i + 3] = 255;
      }
    b.g.putImageData(img, 0, 0);
  });
}

// ---- glitch ----
function glitchScene(g: Ctx): void {
  dot(g, 200, 150, 82, KAKI);
  g.fillStyle = INK;
  font(g, 84, 800);
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("GLITCH", 200, 154);
}
const glitchClean = () => once("glitch", 800, 600, (b) => glitchScene(units(b)));
function glitchGhost(color: string): HTMLCanvasElement {
  return once(`glitch-${color}`, 800, 600, (b) => {
    const g = units(b);
    glitchScene(g);
    g.globalCompositeOperation = "source-in";
    g.fillStyle = color;
    g.fillRect(0, 0, W, H);
  });
}

// ---- VHS ----
function vhsScene(b: Buf): void {
  const g = units(b);
  const sky = g.createLinearGradient(0, 0, 0, 210);
  sky.addColorStop(0, "#2B3050");
  sky.addColorStop(0.65, "#8E5A66");
  sky.addColorStop(1, "#E39A6A");
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  dot(g, 236, 168, 50, "#F6B26B");
  // the colour runs off to the right, as tape chroma does
  g.globalAlpha = 0.35;
  dot(g, 248, 168, 50, "#F08A4B");
  g.globalAlpha = 0.18;
  dot(g, 262, 166, 48, "#E0603C");
  g.globalAlpha = 1;
  g.fillStyle = "#1A1622";
  g.beginPath();
  g.moveTo(0, 214);
  g.bezierCurveTo(110, 186, 220, 222, 400, 200);
  g.lineTo(400, 300);
  g.lineTo(0, 300);
  g.fill();
  g.fillStyle = "#3A6C8C";
  g.globalAlpha = 0.25;
  g.fillRect(0, 216, W, 4);
  g.globalAlpha = 1;
}

// ---- datamosh ----
function moshA(g: Ctx): void {
  g.fillStyle = PAPER;
  g.fillRect(0, 0, W, H);
  still(g);
}
function moshB(g: Ctx): void {
  g.fillStyle = NIGHT;
  g.fillRect(0, 0, W, H);
  g.fillStyle = INK_2;
  for (let i = 0; i < 6; i++) g.fillRect(20 + i * 66, 0, 30, H);
  g.strokeStyle = PALE;
  g.lineWidth = 22;
  g.beginPath();
  g.arc(250, 150, 72, 0, TAU);
  g.stroke();
}

// ---- pixelate ----
function face(g: Ctx): void {
  g.fillStyle = PAPER;
  g.fillRect(0, 0, W, H);
  g.fillStyle = INK;
  g.beginPath();
  g.ellipse(200, 300, 130, 74, 0, Math.PI, TAU);
  g.fill();
  dot(g, 200, 136, 80, KAKI);
  dot(g, 172, 122, 10, INK);
  dot(g, 228, 122, 10, INK);
  g.strokeStyle = INK;
  g.lineWidth = 9;
  g.lineCap = "round";
  g.beginPath();
  g.arc(200, 150, 34, 0.18 * Math.PI, 0.82 * Math.PI);
  g.stroke();
}

// ---- dither ----
const BAYER = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
];

export const PAINT: Record<string, Paint> = {
  // Grain re-seeded on every frame of a 10 fps clock, with a little gate
  // weave, exposure flicker and dust. Fades in from clean and back out.
  "film-grain": (g, t) => {
    const s = step(t);
    const a = env(t, 0.08, 0.2, 0.84, 0.96);
    fill(g, PAPER);
    g.save();
    g.translate((rand(s, 1) - 0.5) * 3 * a, (rand(s, 2) - 0.5) * 3 * a);
    still(g);
    g.restore();
    g.fillStyle = `rgba(110, 70, 30, ${(0.05 + 0.05 * rand(s, 3)) * a})`;
    g.fillRect(0, 0, W, H);
    g.globalAlpha = 0.9 * a;
    g.drawImage(grain(s), 0, 0, W, H);
    // dust and the odd hair
    g.globalAlpha = a;
    g.fillStyle = INK;
    g.strokeStyle = INK;
    for (let k = 0; k < 4; k++)
      if (rand(s, k, 5) < 0.35) dot(g, rand(s, k, 6) * W, rand(s, k, 7) * H, 0.8 + rand(s, k, 8) * 2, INK);
    if (rand(s, 9) < 0.22) {
      const x = rand(s, 10) * W, y = rand(s, 11) * H;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, y);
      g.bezierCurveTo(x + 20, y - 14, x + 8, y + 26, x + 30, y + 30);
      g.stroke();
    }
  },

  // The subject wears away: holes and specks from a texture that is swapped
  // every few frames, plus a couple of stains. Clean, worn, clean.
  grunge: (g, t) => {
    const a = env(t, 0.06, 0.24, 0.8, 0.96);
    fill(g, PAPER);
    dot(g, 200, 150, 96, KAKI);
    g.fillStyle = INK;
    font(g, 76, 800);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("GRUNGE", 200, 154);
    if (a < 0.002) return;
    // stains
    for (let k = 0; k < 3; k++) {
      const x = 80 + rand(k, 31) * 240, y = 70 + rand(k, 32) * 160, r = 40 + rand(k, 33) * 50;
      const st = g.createRadialGradient(x, y, r * 0.2, x, y, r);
      st.addColorStop(0, `rgba(120, 72, 30, ${0.12 * a})`);
      st.addColorStop(0.8, `rgba(120, 72, 30, ${0.06 * a})`);
      st.addColorStop(1, "rgba(120, 72, 30, 0)");
      g.fillStyle = st;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // wear: paper-coloured holes and ink specks, from the field at a jumping offset
    const s = step(t, 13);
    const ox = Math.floor(rand(s, 1) * (GW - 200)), oy = Math.floor(rand(s, 2) * (GH - 150));
    const f = field();
    const b = buf("grunge", 200, 150);
    const img = b.g.createImageData(200, 150);
    const d = img.data;
    const hole = 0.36 * a, speck = 1 - 0.035 * a;
    for (let y = 0; y < 150; y++)
      for (let x = 0; x < 200; x++) {
        const v = f[(y + oy) * GW + x + ox] ?? 0.5;
        const i = (y * 200 + x) * 4;
        if (v < hole) {
          d[i] = d[i + 1] = d[i + 2] = 255;
          d[i + 3] = Math.min(255, (hole - v) * 2600);
        } else if (v > speck + 0.32) {
          d[i] = d[i + 1] = d[i + 2] = 18;
          d[i + 3] = 220;
        }
      }
    b.g.putImageData(img, 0, 0);
    g.drawImage(b.c, 0, 0, W, H);
  },

  // Tone sampled on a 10-unit grid becomes orange and ink dots sized by
  // coverage. Wipes in from the left, holds, wipes back.
  halftone: (g, t) => {
    const scene = (c: Ctx) => {
      c.fillStyle = PAPER;
      c.fillRect(0, 0, W, H);
      const sh = c.createRadialGradient(170, 96, 4, 200, 126, 92);
      sh.addColorStop(0, mix(PAPER, KAKI, 0.25));
      sh.addColorStop(0.55, KAKI);
      sh.addColorStop(1, mix(KAKI, INK, 0.55));
      c.fillStyle = sh;
      c.beginPath();
      c.arc(200, 126, 88, 0, TAU);
      c.fill();
      const bar = c.createLinearGradient(50, 0, 350, 0);
      bar.addColorStop(0, INK);
      bar.addColorStop(1, PAPER);
      c.fillStyle = bar;
      c.fillRect(50, 234, 300, 36);
    };
    const C = 10, NX = W / C, NY = H / C;
    if (!halftonePx) {
      const smp = buf("halftone", NX, NY);
      scene(units(smp));
      halftonePx = smp.g.getImageData(0, 0, NX, NY).data;
    }
    const px = halftonePx;
    const p = smooth(span(t, 0.08, 0.4)) - smooth(span(t, 0.6, 0.92));
    const edge = p * W;
    g.save();
    g.beginPath();
    g.rect(edge, 0, W - edge, H);
    g.clip();
    scene(g);
    g.restore();
    if (edge <= 0) return;
    g.save();
    g.beginPath();
    g.rect(0, 0, edge, H);
    g.clip();
    fill(g, PAPER);
    const rMax = C * 0.72;
    for (const [ink, color] of [[false, KAKI], [true, INK]] as const) {
      g.fillStyle = color;
      g.beginPath();
      for (let j = 0; j < NY; j++)
        for (let i = 0; i < NX; i++) {
          const k = (j * NX + i) * 4;
          const R = px[k] ?? 255, B = px[k + 2] ?? 255;
          const o = clamp((R - B) / 175);
          const kk = clamp((255 - R - 38 * o) / 237);
          const r = rMax * Math.sqrt(ink ? kk : o);
          if (r < 0.4) continue;
          const x = (i + 0.5) * C, y = (j + 0.5) * C;
          g.moveTo(x + r, y);
          g.arc(x, y, r, 0, TAU);
        }
      g.fill();
    }
    g.restore();
  },

  // The same picture: in colour, then navy and orange, then wine and yellow.
  duotone: (g, t) => {
    const pics = [duotone("clean", "", ""), duotone("a", "#1B2556", "#F7A35C"), duotone("b", "#5A0F2E", "#FFE066")];
    const cuts = [0.1, 0.43, 0.76];
    let cur = 0, next = 0, p = 0;
    for (let k = 0; k < 3; k++) {
      const q = inOutWipe(span(t, cuts[k] ?? 0, (cuts[k] ?? 0) + 0.14));
      if (q > 0) {
        cur = k;
        next = (k + 1) % 3;
        p = q;
      }
    }
    if (p >= 1) {
      cur = next;
      p = 0;
    }
    g.drawImage(pics[cur] ?? pics[0]!, 0, 0, W, H);
    if (p > 0) {
      g.save();
      g.beginPath();
      g.rect(0, 0, p * W, H);
      g.clip();
      g.drawImage(pics[next] ?? pics[0]!, 0, 0, W, H);
      g.restore();
    }
  },

  // A lit sphere snaps from smooth to 8, 5, 3, 2 levels and back.
  posterize: (g, t) => {
    const seq = [0, 8, 5, 3, 2, 3, 5, 8];
    const n = seq[Math.min(seq.length - 1, Math.floor(t * seq.length))] ?? 0;
    g.drawImage(posterized(n), 0, 0, W, H);
    font(g, 15, 600);
    g.fillStyle = INK_2;
    g.textAlign = "left";
    g.fillText(n ? `${n} levels` : "smooth", 20, 30);
  },

  // Outlines redrawn on every other frame with a fresh wobble; the fill is
  // its own drawing, slightly off register.
  "line-boil": (g, t) => {
    const s = step(t);
    fill(g, PAPER);
    const shapes: { pts: Pt[]; fill?: string }[] = [
      { pts: circlePts(104, 150, 54, 22), fill: KAKI },
      { pts: polyPts([[160, 104], [248, 104], [248, 196], [160, 196]], 6) },
      { pts: polyPts([[296, 196], [344, 104], [392, 196]], 6).map(([x, y]): Pt => [x - 14, y]), fill: PALE },
    ];
    g.lineJoin = "round";
    shapes.forEach((sh, k) => {
      if (sh.fill) {
        g.save();
        g.translate(4, 4);
        wobblePath(g, sh.pts, [s, k, 9], 5);
        g.fillStyle = sh.fill;
        g.fill();
        g.restore();
      }
      wobblePath(g, sh.pts, [s, k], 4.5);
      g.strokeStyle = INK;
      g.lineWidth = 5;
      g.stroke();
    });
    // ground line, also hand drawn
    g.beginPath();
    for (let i = 0; i <= 12; i++) {
      const x = 40 + i * 27, y = 236 + (rand(s, 50, i) - 0.5) * 4;
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.lineWidth = 4;
    g.stroke();
  },

  // The corners close in and open out again, like a slow breath.
  vignette: (g, t) => {
    const s = 0.5 - 0.5 * Math.cos(TAU * t);
    fill(g, PAPER);
    still(g);
    g.save();
    g.translate(200, 150);
    g.scale(1, 0.75);
    const v = g.createRadialGradient(0, 0, lerp(250, 110, s), 0, 0, 300);
    v.addColorStop(0, "rgba(18, 18, 18, 0)");
    v.addColorStop(1, `rgba(18, 18, 18, ${0.9 * s})`);
    g.fillStyle = v;
    g.fillRect(-200, -200, 400, 400);
    g.restore();
  },

  // The fills fade away and leave only the edges a Sobel filter found.
  "find-edges": (g, t) => {
    const a = env(t, 0.12, 0.3, 0.68, 0.86);
    edgeScene(g);
    if (a <= 0) return;
    g.globalAlpha = a;
    g.drawImage(edges(), 0, 0, W, H);
  },

  // Cyan, magenta and yellow copies multiply back to black. On each hit
  // they jump apart, shiver, and snap together.
  "rgb-split": (g, t) => {
    const s = step(t);
    const burst = (a: number, b: number) => out(span(t, a, a + 0.03)) * (1 - inCubic(span(t, b - 0.05, b)));
    const h = burst(0.1, 0.4), v = burst(0.58, 0.86);
    const jit = (k: number) => (rand(s, k) - 0.5) * 5;
    const d = 13;
    const off: [string, number, number][] = [
      ["#00FFFF", -d * h - d * 0.6 * v + jit(1) * (h + v), d * 0.6 * v],
      ["#FF00FF", d * h + d * 0.6 * v + jit(2) * (h + v), -d * 0.6 * v + jit(3) * v],
      ["#FFFF00", jit(4) * h, d * 0.5 * h + jit(5) * (h + v)],
    ];
    fill(g, PAPER);
    g.globalCompositeOperation = "multiply";
    font(g, 150, 800);
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (const [color, x, y] of off) {
      g.fillStyle = color;
      g.fillText("RGB", 200 + x, 156 + y);
    }
  },

  // Clean, then bursts of slices jumping sideways, colour ghosts and broken blocks.
  glitch: (g, t) => {
    const s = step(t);
    fill(g, PAPER);
    const clean = glitchClean();
    const hot = [5, 6, 7, 15, 16, 19, 20].includes(s);
    if (!hot) {
      g.drawImage(clean, 0, 0, W, H);
      return;
    }
    const r = prng(s * 131 + 7);
    const shift = (r() - 0.5) * 16;
    g.globalCompositeOperation = "multiply";
    g.drawImage(glitchGhost("#00E0FF"), -10 + shift, 0, W, H);
    g.drawImage(glitchGhost("#FF2E88"), 9 + shift, 2, W, H);
    g.globalCompositeOperation = "source-over";
    g.drawImage(clean, shift, 0, W, H);
    const n = 4 + Math.floor(r() * 5);
    for (let k = 0; k < n; k++) {
      const y = r() * H, h = 4 + r() * 34, dx = (r() - 0.5) * 140;
      g.fillStyle = PAPER;
      g.fillRect(0, y, W, h);
      if (r() < 0.4) {
        g.globalCompositeOperation = "multiply";
        g.drawImage(glitchGhost(r() < 0.5 ? "#00E0FF" : "#FF2E88"), 0, y * 2, 800, h * 2, dx - 12, y, W, h);
        g.globalCompositeOperation = "source-over";
      }
      g.drawImage(clean, 0, y * 2, 800, h * 2, dx, y, W, h);
    }
    const m = 2 + Math.floor(r() * 4);
    const blocks = [KAKI, INK, "#00E0FF", "#FF2E88", MIST];
    for (let k = 0; k < m; k++) {
      g.fillStyle = blocks[Math.floor(r() * blocks.length)] ?? INK;
      g.fillRect(Math.floor(r() * 36) * 10, Math.floor(r() * 28) * 10, 10 + Math.floor(r() * 6) * 10, 6 + Math.floor(r() * 3) * 6);
    }
  },

  // A glowing picture behind fine dark lines; a soft bright bar rolls down once a loop.
  scanlines: (g, t) => {
    const s = step(t);
    fill(g, "#241E1A");
    g.save();
    g.shadowColor = KAKI;
    g.shadowBlur = 40;
    dot(g, 200, 128, 64, KAKI);
    g.restore();
    g.fillStyle = PALE;
    font(g, 28, 800);
    g.textAlign = "center";
    g.fillText("ON AIR", 200, 244);
    // flicker
    g.fillStyle = `rgba(255, 236, 220, ${0.02 + 0.03 * rand(s, 1)})`;
    g.fillRect(0, 0, W, H);
    // the rolling bar
    const y = lerp(-70, 370, t);
    const bar = g.createLinearGradient(0, y - 60, 0, y + 60);
    bar.addColorStop(0, "rgba(255, 230, 210, 0)");
    bar.addColorStop(0.5, "rgba(255, 230, 210, 0.2)");
    bar.addColorStop(1, "rgba(255, 230, 210, 0)");
    g.fillStyle = bar;
    g.fillRect(0, y - 60, W, 120);
    // the lines
    g.fillStyle = "rgba(0, 0, 0, 0.55)";
    for (let ly = 0; ly < H; ly += 5) g.fillRect(0, ly + 2.5, W, 2.5);
    // the tube's curved corners
    g.save();
    g.translate(200, 150);
    g.scale(1, 0.75);
    const v = g.createRadialGradient(0, 0, 170, 0, 0, 290);
    v.addColorStop(0, "rgba(0, 0, 0, 0)");
    v.addColorStop(1, "rgba(0, 0, 0, 0.75)");
    g.fillStyle = v;
    g.fillRect(-200, -200, 400, 400);
    g.restore();
  },

  // A soft tape picture with chroma bleed, rows that jitter, a tracking band
  // of noise near the bottom and the deck's on-screen text.
  vhs: (g, t) => {
    const s = step(t);
    const pic = buf("vhs", 200, 150);
    if (!made.has("vhs")) {
      vhsScene(pic);
      made.add("vhs");
    }
    fill(g, "#0C0A10");
    const band = 150 + 44 * Math.sin(TAU * t) + (rand(s, 99) - 0.5) * 6;
    const rows = 60, rh = H / rows;
    for (let i = 0; i < rows; i++) {
      const y = i * rh;
      const inBand = Math.abs(y + rh / 2 - band) < 12;
      const dx = (rand(s, i) - 0.5) * 2.4 + (inBand ? (rand(s, i, 3) - 0.3) * 30 : 0) + 3 * Math.sin(TAU * t + i * 0.08);
      g.drawImage(pic.c, 0, i * 2.5, 200, 2.5, dx, y, W, rh + 0.5);
    }
    // tracking noise
    g.fillStyle = "rgba(255, 255, 255, 0.75)";
    for (let k = 0; k < 26; k++) {
      const y = band - 12 + rand(s, k, 4) * 24;
      g.fillRect(rand(s, k, 5) * W, y, 6 + rand(s, k, 6) * 60, 1 + rand(s, k, 7) * 1.5);
    }
    if (rand(s, 8) < 0.5) g.fillRect(rand(s, 9) * W, rand(s, 10) * H, 20 + rand(s, 11) * 80, 1);
    // on-screen display
    g.save();
    font(g, 22, 700);
    g.fillStyle = "#F4F4F0";
    g.shadowColor = "rgba(0, 0, 0, 0.6)";
    g.shadowOffsetX = 2;
    g.shadowOffsetY = 2;
    g.textAlign = "left";
    g.fillText("PLAY ▶", 24, 42);
    font(g, 18, 700);
    g.fillText("AM 10:24", 24, 252);
    g.fillText("JAN. 21 1997", 24, 276);
    g.textAlign = "right";
    g.fillText("SP", 376, 42);
    g.restore();
  },

  // Shot A, then a cut where the blocks of A are dragged by B's motion until
  // B fills in; then the same from B back to A.
  datamosh: (g, t) => {
    const A = once("mosh-a", 400, 300, (b) => moshA(units(b)));
    const B = once("mosh-b", 400, 300, (b) => moshB(units(b)));
    const go = span(t, 0.06, 0.44), back = span(t, 0.56, 0.94);
    const [from, to, p, seed] = back > 0 ? [B, A, back, 2] : [A, B, go, 1];
    if (p <= 0 || p >= 1) {
      g.drawImage(p >= 1 ? to : from, 0, 0, W, H);
      return;
    }
    const S = 25;
    const e = 70 * p + 60 * p * p;
    for (let j = 0; j < H / S; j++)
      for (let i = 0; i < W / S; i++) {
        const x = i * S, y = j * S;
        const swapAt = 0.4 + 0.55 * noise(i / 3, j / 3, seed + 9) + 0.08 * rand(i, j, seed);
        if (p > swapAt) {
          g.drawImage(to, x, y, S, S, x, y, S, S);
          continue;
        }
        const vx = seed === 1 ? 1 : -1;
        const mx = vx * (0.5 + noise(i / 5, j / 5, seed)), my = (noise(i / 5, j / 5, seed + 5) - 0.5) * 1.4;
        const sx = clamp(x - mx * e, 0, W - S), sy = clamp(y - my * e, 0, H - S);
        g.drawImage(from, sx, sy, S, S, x, y, S, S);
      }
  },

  // Blocks of 4, 10, 20, 50 units, and back to sharp.
  pixelate: (g, t) => {
    const seq = [0, 4, 10, 20, 50, 20, 10, 4];
    const b = seq[Math.min(seq.length - 1, Math.floor(t * seq.length))] ?? 0;
    if (!b) {
      face(g);
      return;
    }
    const small = once(`mosaic${b}`, W / b, H / b, (bf) => face(units(bf)));
    g.imageSmoothingEnabled = false;
    g.drawImage(small, 0, 0, W, H);
  },

  // A lit sphere over a scrolling ramp, in two colours: an 8 × 8 Bayer matrix
  // decides which cells go dark.
  dither: (g, t) => {
    const C = 5, NX = W / C, NY = H / C;
    const b = buf("dither", NX, NY);
    const img = b.g.createImageData(NX, NY);
    const d = img.data;
    const cx = 200, cy = 140, R = 92;
    for (let j = 0; j < NY; j++)
      for (let i = 0; i < NX; i++) {
        const x = (i + 0.5) * C, y = (j + 0.5) * C;
        const nx = (x - cx) / R, ny = (y - cy) / R, rr = nx * nx + ny * ny;
        let v: number;
        if (rr < 1) {
          const nz = Math.sqrt(1 - rr);
          v = 0.05 + 0.95 * Math.max(0, -0.55 * nx - 0.6 * ny + 0.58 * nz);
        } else {
          v = 0.66 + 0.28 * Math.cos(TAU * (x / W - t));
        }
        const on = v * 64 < (BAYER[(j % 8) * 8 + (i % 8)] ?? 0) + 0.5;
        const k = (j * NX + i) * 4;
        const c = on ? 18 : 255;
        d[k] = c;
        d[k + 1] = c;
        d[k + 2] = c;
        d[k + 3] = 255;
      }
    b.g.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(b.c, 0, 0, W, H);
  },
};

/** An eased wipe that starts and lands softly. */
function inOutWipe(p: number): number {
  return p <= 0 ? 0 : p >= 1 ? 1 : smooth(p);
}
