// Light: how each term's loop is drawn. See kit.ts.
import {
  INK, PAPER, KAKI, KAKI_2, PALE, GREY, GREY_2, MIST, NIGHT, TAU, W, H,
  clamp, lerp, span, out, inOut, smooth, pingPong, pct, mix, rect, circle, blur, rand, loopNoise, fill, dot, font,
  type Paint, type Shapes,
} from "./kit.ts";

export const SHAPES: Record<string, Shapes> = {
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

/** A colour from the palette with an alpha. */
function rgba(hex: string, a: number): string {
  const ch = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  return `rgba(${ch(1)},${ch(3)},${ch(5)},${clamp(a).toFixed(3)})`;
}

/** Canvas units to device pixels: shadowBlur and shadowOffset ignore the transform. */
function px(g: CanvasRenderingContext2D): number {
  const m = g.getTransform();
  return Math.hypot(m.a, m.b);
}

/** A soft round light: colour at the centre fading to nothing at r. */
function halo(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, a: number): void {
  if (r <= 0 || a <= 0) return;
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, rgba(color, a));
  gr.addColorStop(0.35, rgba(color, a * 0.45));
  gr.addColorStop(1, rgba(color, 0));
  g.fillStyle = gr;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/** Convex hull of points (monotone chain), for the swept long shadow. */
function hull(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [], up: [number, number][] = [];
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 0) lo.pop();
    lo.push(q);
  }
  for (const q of p.reverse()) {
    while (up.length >= 2 && cross(up[up.length - 2]!, up[up.length - 1]!, q) <= 0) up.pop();
    up.push(q);
  }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

/** Low hills: the "footage" under a light effect. */
function hills(g: CanvasRenderingContext2D): void {
  g.fillStyle = "#2A2420";
  g.beginPath();
  g.moveTo(0, 205);
  g.bezierCurveTo(90, 160, 160, 170, 230, 200);
  g.bezierCurveTo(290, 222, 340, 180, 400, 190);
  g.lineTo(400, 300);
  g.lineTo(0, 300);
  g.fill();
  g.fillStyle = "#352D27";
  g.beginPath();
  g.moveTo(0, 250);
  g.bezierCurveTo(120, 225, 230, 235, 400, 255);
  g.lineTo(400, 300);
  g.lineTo(0, 300);
  g.fill();
}

export const PAINT: Record<string, Paint> = {
  glow: (g, t) => {
    fill(g, NIGHT);
    const b = 0.5 - 0.5 * Math.cos(TAU * t); // breathes 0 → 1 → 0
    const cx = 200, cy = 150, r = 66;
    g.globalCompositeOperation = "lighter";
    halo(g, cx, cy, 120 + 60 * b, KAKI, 0.10 + 0.22 * b);
    const ring = (w: number, color: string, a: number) => {
      g.strokeStyle = rgba(color, a);
      g.lineWidth = w;
      g.beginPath();
      g.arc(cx, cy, r, 0, TAU);
      g.stroke();
    };
    // the bloom: the ring drawn blurred, wider and brighter as it breathes
    const k = px(g);
    g.save();
    g.shadowColor = KAKI;
    for (const [blur, w, al] of [[48, 14, 0.5], [22, 9, 0.7], [8, 6, 0.8]] as const) {
      g.shadowBlur = blur * (0.45 + 0.8 * b) * k;
      ring(w, KAKI, al * (0.45 + 0.55 * b));
    }
    g.restore();
    ring(7, KAKI_2, 0.9);
    ring(3.2, "#FFF1E4", 1);
    // the same light as a dot in the middle
    halo(g, cx, cy, 34 + 22 * b, KAKI, 0.35 + 0.3 * b);
    dot(g, cx, cy, 7, "#FFF1E4");
  },

  "lens-flare": (g, t) => {
    fill(g, NIGHT);
    hills(g);
    const a = TAU * t;
    const sx = 200 - 140 * Math.cos(a), sy = 82 - 34 * Math.sin(a);
    const cx = 200, cy = 150;
    g.globalCompositeOperation = "lighter";
    // the source: halo, star and the long horizontal streak
    halo(g, sx, sy, 130, KAKI, 0.38);
    halo(g, sx, sy, 40, PALE, 0.9);
    g.save();
    g.translate(sx, sy);
    g.scale(1, 0.035);
    halo(g, 0, 0, 260, PALE, 0.7);
    g.restore();
    g.strokeStyle = rgba(PALE, 0.35);
    g.lineWidth = 1.2;
    for (let k = 0; k < 6; k++) {
      const an = (k * TAU) / 6 + 0.3;
      const len = k % 2 ? 34 : 52;
      g.beginPath();
      g.moveTo(sx, sy);
      g.lineTo(sx + len * Math.cos(an), sy + len * Math.sin(an));
      g.stroke();
    }
    dot(g, sx, sy, 6, "#FFF6EC");
    // ghosts on the line from the source through the centre
    const ghosts: [number, number, string, number][] = [
      [0.55, 9, PALE, 0.32], [1.25, 26, KAKI, 0.16], [1.55, 7, PALE, 0.4],
      [1.9, 44, KAKI_2, 0.1], [2.25, 14, KAKI, 0.28], [2.6, 22, PALE, 0.14],
    ];
    for (const [k, r, color, al] of ghosts) {
      const x = sx + (cx - sx) * k, y = sy + (cy - sy) * k;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, rgba(color, al * 0.5));
      gr.addColorStop(0.8, rgba(color, al));
      gr.addColorStop(1, rgba(color, 0));
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fill();
    }
  },

  "light-leak": (g, t) => {
    // the footage: a grey dusk over hills, a pale sun
    const sky = g.createLinearGradient(0, 0, 0, 220);
    sky.addColorStop(0, "#2B2D31");
    sky.addColorStop(1, "#5A5C61");
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    dot(g, 270, 158, 18, "#8C8E93");
    g.fillStyle = "#24262A";
    g.beginPath();
    g.moveTo(0, 200);
    g.bezierCurveTo(90, 160, 160, 170, 230, 196);
    g.bezierCurveTo(290, 218, 340, 182, 400, 190);
    g.lineTo(400, 300);
    g.lineTo(0, 300);
    g.fill();
    g.fillStyle = "#18191C";
    g.beginPath();
    g.moveTo(0, 250);
    g.bezierCurveTo(120, 226, 230, 236, 400, 256);
    g.lineTo(400, 300);
    g.lineTo(0, 300);
    g.fill();
    // the leaks: warm washes that slide in from the edges and out again
    g.globalCompositeOperation = "screen";
    const leaks: [number, number, number, number, number, string, number][] = [
      // from x, y → to x, y (they swing between), radius, colour, phase
      [-120, 60, 40, 120, 250, KAKI, 0],
      [460, 40, 330, 110, 200, "#E8553A", 0.45],
      [120, 380, 160, 270, 170, KAKI_2, 0.72],
    ];
    leaks.forEach(([x0, y0, x1, y1, r, color, ph], i) => {
      const f = 0.5 - 0.5 * Math.cos(TAU * (t + ph)); // in and out once a loop
      const x = lerp(x0, x1, f) + 30 * (loopNoise(t, i * 3 + 1) - 0.5);
      const y = lerp(y0, y1, f) + 30 * (loopNoise(t, i * 3 + 2) - 0.5);
      const a = 0.15 + 0.85 * f;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, rgba("#FFE9D2", a));
      gr.addColorStop(0.25, rgba(color, a * 0.95));
      gr.addColorStop(0.7, rgba(color, a * 0.3));
      gr.addColorStop(1, rgba(color, 0));
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
    });
  },

  "god-rays": (g, t) => {
    fill(g, NIGHT);
    const sx = 70, sy = -40;
    g.globalCompositeOperation = "lighter";
    for (let i = 0; i < 9; i++) {
      const base = 0.42 + i * 0.105 + (rand(i, 1) - 0.5) * 0.06;
      const ang = base + 0.035 * Math.sin(TAU * t + rand(i, 2) * TAU);
      const w = 0.018 + 0.03 * rand(i, 3);
      const len = 470;
      const a = (0.13 + 0.14 * rand(i, 4)) * (0.75 + 0.25 * Math.sin(TAU * t * 2 + i));
      const gr = g.createLinearGradient(sx, sy, sx + len * Math.cos(ang), sy + len * Math.sin(ang));
      gr.addColorStop(0, rgba(PALE, a * 1.6));
      gr.addColorStop(0.5, rgba(KAKI_2, a * 0.7));
      gr.addColorStop(1, rgba(KAKI, 0));
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(sx, sy);
      g.lineTo(sx + len * Math.cos(ang - w), sy + len * Math.sin(ang - w));
      g.lineTo(sx + len * Math.cos(ang + w), sy + len * Math.sin(ang + w));
      g.closePath();
      g.fill();
    }
    halo(g, sx, sy, 150, KAKI_2, 0.5);
    halo(g, sx, sy, 70, PALE, 0.8);
    // dust caught in the beams
    for (let i = 0; i < 34; i++) {
      const x = 60 + rand(i, 5) * 330 + 8 * Math.sin(TAU * t + rand(i, 6) * TAU);
      const y = 40 + rand(i, 7) * 240 + 10 * Math.sin(TAU * t * (i % 2 ? 1 : -1) + rand(i, 8) * TAU);
      const tw = 0.5 + 0.5 * Math.sin(TAU * (t * 2 + rand(i, 9)));
      dot(g, x, y, 0.8 + 1.2 * rand(i, 10), rgba(PALE, 0.15 + 0.45 * tw));
    }
  },

  "drop-shadow": (g, t) => {
    fill(g, MIST);
    // rest, lift, hold up, set down, rest
    const lift = inOut(span(t, 0.1, 0.4)) * (1 - inOut(span(t, 0.62, 0.92)));
    const w = 200, h = 128, x = 100, y = 86 - 12 * lift;
    const s = px(g);
    g.save();
    g.shadowColor = `rgba(18,18,18,${(0.26 - 0.08 * lift).toFixed(3)})`;
    g.shadowBlur = (4 + 30 * lift) * s;
    g.shadowOffsetY = (3 + 20 * lift) * s;
    g.fillStyle = PAPER;
    roundRect(g, x, y, w, h, 12);
    g.fill();
    g.restore();
    // what's on the card
    dot(g, x + 34, y + 36, 14, KAKI);
    g.fillStyle = INK;
    roundRect(g, x + 58, y + 26, 92, 9, 4.5);
    g.fill();
    g.fillStyle = GREY;
    roundRect(g, x + 58, y + 41, 60, 7, 3.5);
    g.fill();
    for (const [dy, len] of [[76, 160], [92, 140], [108, 96]] as const) {
      g.fillStyle = MIST;
      roundRect(g, x + 20, y + dy - 4, len, 8, 4);
      g.fill();
    }
  },

  "long-shadow": (g, t) => {
    fill(g, MIST);
    const grow = out(span(t, 0.1, 0.42)) * (1 - inOut(span(t, 0.72, 0.94)));
    const tx = 110, ty = 60, ts = 180, cx = 200, cy = 150, r = 46;
    // the tile and its own long shadow on the desk
    g.fillStyle = KAKI;
    roundRect(g, tx, ty, ts, ts, 28);
    g.fill();
    g.save();
    roundRect(g, tx, ty, ts, ts, 28);
    g.clip();
    const L = 150 * grow;
    const pts: [number, number][] = [];
    for (let k = 0; k < 24; k++) {
      const a = (k * TAU) / 24;
      const px0 = cx + r * Math.cos(a), py0 = cy + r * Math.sin(a);
      pts.push([px0, py0], [px0 + L, py0 + L]);
    }
    const hl = hull(pts);
    g.fillStyle = mix(KAKI, INK, 0.28);
    g.beginPath();
    hl.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fill();
    g.restore();
    // the icon: a play button
    dot(g, cx, cy, r, PAPER);
    g.fillStyle = KAKI;
    g.beginPath();
    g.moveTo(cx - 13, cy - 20);
    g.lineTo(cx + 22, cy);
    g.lineTo(cx - 13, cy + 20);
    g.closePath();
    g.fill();
  },

  "light-sweep": (g, t) => {
    fill(g, MIST);
    const x = 80, y = 80, w = 240, h = 148;
    const s = px(g);
    g.save();
    g.shadowColor = "rgba(18,18,18,0.22)";
    g.shadowBlur = 16 * s;
    g.shadowOffsetY = 8 * s;
    g.fillStyle = INK;
    roundRect(g, x, y, w, h, 14);
    g.fill();
    g.restore();
    // what's on the card: a chip, a logo, a number
    g.fillStyle = KAKI_2;
    roundRect(g, x + 24, y + 42, 38, 28, 5);
    g.fill();
    dot(g, x + w - 52, y + 36, 14, KAKI);
    dot(g, x + w - 34, y + 36, 14, rgba(PALE, 0.85));
    font(g, 15, 600);
    g.fillStyle = GREY;
    g.fillText("4242  1024  0726", x + 24, y + 108);
    font(g, 10, 500);
    g.fillStyle = GREY_2;
    g.fillText("KAMISHIBAI", x + 24, y + 130);
    // the highlight, only on the card
    const p = smooth(span(t, 0.12, 0.72));
    const bx = -60 + 520 * p;
    if (p > 0 && p < 1) {
      const gr = g.createLinearGradient(bx - 90, 0, bx + 90, 0);
      gr.addColorStop(0, "rgba(255,255,255,0)");
      gr.addColorStop(0.3, "rgba(255,255,255,0.12)");
      gr.addColorStop(0.47, "rgba(255,255,255,0.4)");
      gr.addColorStop(0.5, "rgba(255,255,255,0.75)");
      gr.addColorStop(0.53, "rgba(255,255,255,0.4)");
      gr.addColorStop(0.7, "rgba(255,255,255,0.12)");
      gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr;
      g.save();
      roundRect(g, x, y, w, h, 14);
      g.clip();
      g.translate(bx, 150);
      g.transform(1, 0, -0.45, 1, 0, 0);
      g.translate(-bx, -150);
      g.fillRect(bx - 90, 0, 180, H);
      g.restore();
    }
  },
};
