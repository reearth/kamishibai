// Transition: how each term's loop is drawn. See kit.ts.
import {
  INK, INK_2, PAPER, KAKI, KAKI_2, PALE, GREY, GREY_2, W, H, TAU,
  clamp, lerp, span, inOut, out, inCubic, smooth, pingPong, noise, rect, circle, fill, dot,
  type Paint, type Shapes,
} from "./kit.ts";

export const SHAPES: Record<string, Shapes> = {
  nuki: (t) => {
    const x = t < 0.35 ? 0 : t < 0.45 ? out((t - 0.35) / 0.1) * 46 : t < 0.65 ? 46 : t < 0.75 ? 46 + Math.pow((t - 0.65) / 0.1, 3) * 70 : 116;
    return [
      rect(8, 10, 84, 80, INK_2),
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
};

// ---- the two shots the paints below cut between ----

interface Scene {
  bg: string;
  /** the point a zoom flies into */
  fx: number;
  fy: number;
  /** the picture, without its background */
  art: (g: CanvasRenderingContext2D) => void;
}

const SHOT_A: Scene = {
  bg: PAPER, fx: 150, fy: 150,
  art: (g) => {
    dot(g, 150, 150, 64, KAKI);
    g.fillStyle = INK;
    g.fillRect(250, 90, 66, 120);
  },
};

const SHOT_B: Scene = {
  bg: INK, fx: 280, fy: 150,
  art: (g) => {
    dot(g, 280, 150, 44, PALE);
    g.fillStyle = GREY;
    g.fillRect(70, 118, 130, 16);
    g.fillStyle = GREY_2;
    g.fillRect(70, 148, 92, 16);
    g.fillRect(70, 178, 110, 16);
  },
};

function shot(g: CanvasRenderingContext2D, s: Scene): void {
  fill(g, s.bg);
  s.art(g);
}

/** A to B in the first half, B back to A in the second; p is the raw 0 → 1 of the change. */
function phase(t: number): { from: Scene; to: Scene; p: number } {
  return t < 0.5 ? { from: SHOT_A, to: SHOT_B, p: span(t, 0.08, 0.42) } : { from: SHOT_B, to: SHOT_A, p: span(t, 0.58, 0.92) };
}

// ---- scratch canvases for the gradient wipe (redrawn in full on every call) ----
const MW = 50, MH = 38;
let maskCv: HTMLCanvasElement | null = null;
let layerCv: HTMLCanvasElement | null = null;
let lumaMap: Float32Array | null = null;

/** The grey map the gradient wipe follows: soft noise in two octaves, stretched to 0..1. */
function luma(): Float32Array {
  if (lumaMap) return lumaMap;
  const m = new Float32Array(MW * MH);
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j < MH; j++)
    for (let i = 0; i < MW; i++) {
      const v = noise(i * 0.1, j * 0.1, 7) * 0.75 + noise(i * 0.25, j * 0.25, 8) * 0.25;
      m[j * MW + i] = v;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  for (let k = 0; k < m.length; k++) m[k] = (m[k]! - lo) / (hi - lo);
  return (lumaMap = m);
}

/** The scene's liquid surface: a level with travelling waves on it. */
function surface(x: number, level: number, wave: number, p: number): number {
  return level + wave * (Math.sin(x * 0.028 + p * 9) * 0.6 + Math.sin(x * 0.067 - p * 6 + 1.3) * 0.4);
}

export const PAINT: Record<string, Paint> = {
  slide: (g, t) => {
    const { from, to, p } = phase(t);
    shot(g, from);
    if (p <= 0) return;
    const x = W * (1 - inOut(p));
    g.save();
    g.translate(x, 0);
    g.shadowColor = "rgba(0,0,0,0.28)";
    g.shadowBlur = 22;
    g.shadowOffsetX = -6;
    g.fillStyle = to.bg;
    g.fillRect(0, 0, W, H);
    g.shadowColor = "transparent";
    g.beginPath();
    g.rect(0, 0, W, H);
    g.clip();
    to.art(g);
    g.restore();
  },

  "zoom-transition": (g, t) => {
    const { from, to, p } = phase(t);
    const q = inOut(p);
    const speed = Math.sin(Math.PI * q);
    // fly into the old shot, then the new one arrives from far away and lands
    const draw = (s: Scene, scale: number, alpha: number) => {
      if (alpha <= 0) return;
      g.globalAlpha = alpha;
      fill(g, s.bg);
      // a few fainter copies, a little smaller each, make the zoom blur
      for (let k = 4; k >= 0; k--) {
        const sc = scale * (1 - k * 0.05 * speed);
        g.globalAlpha = alpha * (k === 0 ? 1 : 0.22);
        g.save();
        g.translate(s.fx, s.fy);
        g.scale(sc, sc);
        g.translate(-s.fx, -s.fy);
        s.art(g);
        g.restore();
      }
      g.globalAlpha = 1;
    };
    // the cut is hidden at the fastest point, where everything is a blur
    if (q < 0.5) draw(from, Math.exp(2.6 * Math.pow(q / 0.5, 2)), 1);
    else draw(to, Math.pow(0.4, Math.pow(1 - span(q, 0.5, 1), 2)), 1);
  },

  "venetian-blinds": (g, t) => {
    const { from, to, p } = phase(t);
    shot(g, from);
    if (p <= 0) return;
    const n = 6, sh = H / n;
    g.save();
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const o = smooth(span(p, i * 0.08, i * 0.08 + 0.6));
      // each slat turns open about its middle
      if (o > 0) g.rect(0, i * sh + (sh * (1 - o)) / 2 - o * 0.5, W, sh * o + o);
    }
    g.clip();
    shot(g, to);
    g.restore();
  },

  "clock-wipe": (g, t) => {
    const { from, to, p } = phase(t);
    shot(g, from);
    if (p <= 0) return;
    const cx = 200, cy = 150, a0 = -Math.PI / 2, a = a0 + inOut(p) * TAU;
    g.save();
    g.beginPath();
    g.moveTo(cx, cy);
    g.arc(cx, cy, 300, a0, a);
    g.closePath();
    g.clip();
    shot(g, to);
    g.restore();
    if (p < 1) {
      g.strokeStyle = KAKI;
      g.lineWidth = 4;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + 300 * Math.cos(a), cy + 300 * Math.sin(a));
      g.stroke();
      dot(g, cx, cy, 6, KAKI);
    }
  },

  "gradient-wipe": (g, t) => {
    const { from, to, p } = phase(t);
    shot(g, from);
    if (p <= 0) return;
    if (p >= 1) return shot(g, to);
    maskCv ??= document.createElement("canvas");
    layerCv ??= document.createElement("canvas");
    const mg = maskCv.getContext("2d"), lg = layerCv.getContext("2d");
    if (!mg || !lg) return;
    // the mask: where the grey map is darker than the threshold, the new shot shows
    maskCv.width = MW;
    maskCv.height = MH;
    const img = mg.createImageData(MW, MH), m = luma(), soft = 0.18;
    const th = lerp(-soft, 1, inOut(p));
    for (let k = 0; k < m.length; k++) {
      img.data[k * 4 + 3] = Math.round(255 * smooth(clamp((th + soft - m[k]!) / soft)));
    }
    mg.putImageData(img, 0, 0);
    // the new shot, cut out by the mask at full resolution
    const dw = g.canvas.width, dh = g.canvas.height;
    if (layerCv.width !== dw || layerCv.height !== dh) {
      layerCv.width = dw;
      layerCv.height = dh;
    }
    lg.setTransform(dw / W, 0, 0, dh / H, 0, 0);
    lg.globalCompositeOperation = "source-over";
    lg.clearRect(0, 0, W, H);
    shot(lg, to);
    lg.globalCompositeOperation = "destination-in";
    lg.imageSmoothingEnabled = true;
    lg.drawImage(maskCv, 0, 0, W, H);
    lg.globalCompositeOperation = "source-over";
    g.drawImage(layerCv, 0, 0, W, H);
  },

  "shape-transition": (g, t) => {
    const { from, to, p } = phase(t);
    shot(g, p < 0.5 ? from : to);
    if (p <= 0 || p >= 1) return;
    const slant = 120;
    const edge = (f: number) => lerp(-slant, W, inOut(f));
    // bands come in in order and leave in reverse, so the last one in covers the cut
    [KAKI, INK_2, PALE].forEach((c, i) => {
      const head = edge(span(p, i * 0.14, i * 0.14 + 0.22));
      const tail = edge(span(p, 0.5 + (2 - i) * 0.14, 0.72 + (2 - i) * 0.14));
      if (head <= tail) return;
      g.fillStyle = c;
      g.beginPath();
      g.moveTo(tail + slant, 0);
      g.lineTo(head + slant, 0);
      g.lineTo(head, H);
      g.lineTo(tail, H);
      g.closePath();
      g.fill();
    });
  },

  "liquid-transition": (g, t) => {
    const { from, to, p } = phase(t);
    shot(g, from);
    if (p <= 0) return;
    if (p >= 1) return shot(g, to);
    const wave = 26 * Math.sin(Math.PI * p);
    // an orange flood leads, the new shot follows a beat behind
    const layers: [number, (g: CanvasRenderingContext2D) => void][] = [
      [inOut(span(p, 0, 0.8)), (gg) => fill(gg, KAKI)],
      [inOut(span(p, 0.2, 1)), (gg) => shot(gg, to)],
    ];
    layers.forEach(([f, paint], li) => {
      if (f <= 0) return;
      const level = lerp(H + 40, -40, f);
      g.save();
      g.beginPath();
      g.moveTo(0, H);
      for (let x = 0; x <= W; x += 8) g.lineTo(x, surface(x, level, wave, p + li * 0.3));
      g.lineTo(W, H);
      g.closePath();
      // drops rising off the surface, still joined to it
      for (const [bx, ph] of [[70, 0], [210, 0.35], [330, 0.7]] as const) {
        const b = Math.sin(Math.PI * clamp(f * 1.6 - ph * 0.5));
        if (b <= 0) continue;
        const sy = surface(bx, level, wave, p + li * 0.3);
        g.moveTo(bx + 20 * b, sy - 12 * b);
        g.arc(bx, sy - 12 * b, 20 * b, 0, TAU);
      }
      g.clip();
      paint(g);
      g.restore();
    });
  },

  // The old shot overexposes to white on the beat, the cut hides at the
  // peak, and the new shot comes up out of the white with a small punch.
  "flash-transition": (g, t) => {
    const half = t < 0.5 ? 0 : 1;
    const u = (t - half * 0.5) / 0.5;
    const from = half ? SHOT_B : SHOT_A, to = half ? SHOT_A : SHOT_B;
    const PEAK = 0.4;
    const rise = inCubic(span(u, PEAK - 0.115, PEAK));
    const fall = 1 - out(span(u, PEAK, PEAK + 0.26));
    const after = u >= PEAK;
    const s = after ? 1 + 0.06 * fall : 1 + 0.025 * rise;
    g.save();
    g.translate(200, 150);
    g.scale(s, s);
    g.translate(-200, -150);
    shot(g, after ? to : from);
    g.restore();
    const white = after ? fall : rise;
    if (white > 0) {
      g.globalAlpha = white;
      fill(g, PAPER);
      g.globalAlpha = 1;
    }
  },

  // Down to black, a held beat of black, then up on the next scene.
  "fade-to-black": (g, t) => {
    const half = t < 0.5 ? 0 : 1;
    const u = (t - half * 0.5) / 0.5;
    const after = u >= 0.5;
    shot(g, half ? (after ? SHOT_A : SHOT_B) : after ? SHOT_B : SHOT_A);
    const dark = smooth(span(u, 0.14, 0.42)) - smooth(span(u, 0.58, 0.86));
    if (dark > 0) {
      g.globalAlpha = dark;
      fill(g, "#000000");
      g.globalAlpha = 1;
    }
  },

  // A bright seam opens down the middle, then the two halves swing apart
  // like doors to show the next shot behind them.
  "barn-door": (g, t) => {
    const { from, to, p } = phase(t);
    const seam = smooth(span(p, 0, 0.2));
    const d = (W / 2 + 24) * inOut(span(p, 0.12, 1));
    if (p <= 0) return shot(g, from);
    if (p >= 1) return shot(g, to);
    shot(g, to);
    // the doors, each with a soft shadow on its open edge
    for (const side of [-1, 1]) {
      g.save();
      g.translate(side * d, 0);
      g.shadowColor = `rgba(0,0,0,${(0.3 * clamp(d / 12)).toFixed(3)})`;
      g.shadowBlur = 18;
      g.shadowOffsetX = side * 6;
      g.fillStyle = from.bg;
      g.fillRect(side < 0 ? 0 : W / 2, 0, W / 2, H);
      g.shadowColor = "transparent";
      g.beginPath();
      g.rect(side < 0 ? 0 : W / 2, 0, W / 2, H);
      g.clip();
      from.art(g);
      g.restore();
    }
    // light spilling through the gap, strongest while it is still narrow
    const glow = seam * (1 - smooth(span(p, 0.3, 0.75)));
    if (glow > 0) {
      const gw = Math.min(2 * d, 10) + 3 * seam;
      g.save();
      g.globalAlpha = glow;
      g.shadowColor = KAKI_2;
      g.shadowBlur = 26;
      g.fillStyle = PAPER;
      const h = H * seam;
      g.fillRect(W / 2 - gw / 2, H / 2 - h / 2, gw, h);
      g.restore();
    }
  },
};
