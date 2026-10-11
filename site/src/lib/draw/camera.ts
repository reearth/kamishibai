// Camera: how each term's loop is drawn. See kit.ts.
import { W, H, TAU, INK, INK_2, PAPER, KAKI, PALE, GREY, GREY_2, MIST, clamp, lerp, span, inOut, out, inCubic, smooth, pingPong, wrap, rand, noise, loopNoise, rect, circle, ground, blur, fill, dot, font, type Paint, type Shapes } from "./kit.ts";
import { figure, type Pose } from "./editing.ts";

export const SHAPES: Record<string, Shapes> = {
  pan: (t) => [
    ground(78),
    ...[30, 46, 24, 52, 36, 42].map((h, k) => rect(wrap(k * 22 - t * 132, 132) - 16, 78 - h, 12, h, k % 2 ? INK_2 : INK)),
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
      ...[-3, -2, -1, 0, 1, 2, 3].map((j) => rect(50 + j * 15 * k - 2.5 * k, 50 - 40 * k, 5 * k, 80 * k, j % 2 ? GREY : GREY_2)),
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
};

// ---- local helpers ----
type G = CanvasRenderingContext2D;

/** A filled polygon through x, y pairs. */
function poly(g: G, pts: number[], color: string): void {
  g.fillStyle = color;
  g.beginPath();
  for (let i = 0; i + 1 < pts.length; i += 2) g.lineTo(pts[i]!, pts[i + 1]!);
  g.closePath();
  g.fill();
}

function rrect(g: G, x: number, y: number, w: number, h: number, r: number, color: string): void {
  g.fillStyle = color;
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.fill();
}

/** A filled band under the curve y = f(x), from x = 0 to W, down to the bottom. */
function ridge(g: G, f: (x: number) => number, color: string, step = 8): void {
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(-10, H + 10);
  for (let x = -10; x <= W + 10; x += step) g.lineTo(x, f(x));
  g.lineTo(W + 10, H + 10);
  g.closePath();
  g.fill();
}

function mono(g: G, px: number, weight = 500): void {
  g.font = `${weight} ${px}px "Geist Mono", ui-monospace, monospace`;
}

/** 0 → 1 → 0, a triangle wave of period 1 */
const tri = (u: number) => 1 - 2 * Math.abs(wrap(u, 1) - 0.5);

// The little character used in crash zoom: a body and an orange head.
function crashScene(g: G): void {
  g.fillStyle = MIST;
  g.fillRect(-40, 200, W + 80, 140);
  rrect(g, 30, 110, 54, 90, 2, GREY);
  rrect(g, 92, 136, 40, 64, 2, GREY);
  rrect(g, 330, 124, 48, 76, 2, GREY);
  for (let k = 0; k < 6; k++) rrect(g, 40 + (k % 2) * 22, 122 + Math.floor(k / 2) * 22, 12, 12, 1, PAPER);
  dot(g, 300, 150, 22, GREY_2);
  g.fillStyle = INK_2;
  g.fillRect(298, 160, 4, 40);
  // the subject
  rrect(g, 241, 178, 18, 24, 5, INK);
  dot(g, 250, 168, 10, KAKI);
  dot(g, 246.4, 167, 1.5, INK);
  dot(g, 253.6, 167, 1.5, INK);
  dot(g, 250, 172.4, 1.1, INK);
}

export const PAINT: Record<string, Paint> = {
  // The camera circles a box with a face. The face swings round, the trees on
  // the horizon slide the other way, and a top view in the corner shows the
  // camera going round.
  orbit: (g, t) => {
    const th = TAU * t;
    const c = Math.cos(th), s = Math.sin(th);
    const HZ = 150;
    g.fillStyle = MIST;
    g.fillRect(0, HZ, W, H - HZ);
    // trees on the horizon slide opposite to the subject's near side
    const L = 480;
    for (let k = 0; k < 8; k++) {
      const x = wrap(k * 60 + 20 * rand(k, 1) + t * L, L) - 40;
      const h = 16 + rand(k, 2) * 26;
      g.fillStyle = GREY_2;
      g.fillRect(x - 1.5, HZ - h * 0.4, 3, h * 0.4);
      g.fillStyle = GREY;
      g.beginPath();
      g.ellipse(x, HZ - h * 0.55, 9 + rand(k, 3) * 6, h * 0.45, 0, 0, TAU);
      g.fill();
    }
    // project a world point: x, z on the ground, y up
    const cx = 200, cy = 196, S = 44, TIP = 0.3;
    const P = (x: number, y: number, z: number): [number, number] => [cx + S * (x * c - z * s), cy - S * y + S * (x * s + z * c) * TIP];
    // marks on the ground in a ring around the subject
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * TAU;
      const x = 2.6 * Math.cos(a), z = 2.6 * Math.sin(a);
      const d = x * s + z * c;
      const [px, py] = P(x, 0, z);
      dot(g, px, py, 2.2 + d * 0.5, k % 4 === 0 ? GREY_2 : GREY);
    }
    // shadow
    g.fillStyle = "rgba(18,18,18,0.12)";
    g.beginPath();
    g.ellipse(cx, cy + 4, S * 1.7, S * 1.7 * TIP + 6, 0, 0, TAU);
    g.fill();
    // the box: side faces facing the camera, then the top
    const HT = 1.5;
    const faces: [number, number, number, number, number, number, string][] = [
      [0, 1, -1, 1, 1, 1, KAKI], // front (+z), with the face
      [1, 0, 1, 1, 1, -1, INK],
      [0, -1, 1, -1, -1, -1, INK_2],
      [-1, 0, -1, -1, -1, 1, GREY_2],
    ];
    for (const [nx, nz, x0, z0, x1, z1, col] of faces) {
      const nd = nx * s + nz * c;
      if (nd <= 0) continue;
      const a = P(x0, 0, z0), b = P(x1, 0, z1), b2 = P(x1, HT, z1), a2 = P(x0, HT, z0);
      poly(g, [a[0], a[1], b[0], b[1], b2[0], b2[1], a2[0], a2[1]], col);
      if (nz === 1) {
        // eyes on the front face, narrowed as it turns away
        for (const ex of [-0.38, 0.38]) {
          const [px, py] = P(ex, 0.95, 1);
          g.fillStyle = INK;
          g.beginPath();
          g.ellipse(px, py, 4.5 * nd + 0.5, 6, 0, 0, TAU);
          g.fill();
        }
      }
    }
    const tp = [P(-1, HT, -1), P(1, HT, -1), P(1, HT, 1), P(-1, HT, 1)];
    poly(g, tp.flat(), PAPER);
    g.strokeStyle = INK;
    g.lineWidth = 1.5;
    g.lineJoin = "round";
    g.stroke();
    // top view: the camera going round the subject
    const ix = 350, iy = 50, ir = 26;
    g.strokeStyle = GREY_2;
    g.lineWidth = 1.5;
    g.setLineDash([3, 4]);
    g.beginPath();
    g.arc(ix, iy, ir, 0, TAU);
    g.stroke();
    g.setLineDash([]);
    rrect(g, ix - 6, iy - 6, 12, 12, 2, KAKI);
    // the camera sits at screen-bottom (toward the viewer) at th = 0 and goes round
    const ca = Math.PI / 2 - th;
    const kx = ix + ir * Math.cos(ca), ky = iy + ir * Math.sin(ca);
    g.save();
    g.translate(kx, ky);
    g.rotate(ca + Math.PI);
    poly(g, [-6, -7, 7, -7, 7, 7, -6, 7], INK);
    poly(g, [7, -3, 12, -7, 12, 7, 7, 3], INK);
    g.restore();
  },

  // Wide shot, then a zoom in a few frames onto the face, a hold, and a cut back.
  "crash-zoom": (g, t) => {
    const T0 = 0.3, T1 = 0.37, CUT = 0.86;
    const tx = 250, ty = 168, Z = 7;
    const at = (p: number) => {
      const z = Math.exp(p * Math.log(Z));
      g.save();
      g.translate(lerp(tx, 200, p), lerp(ty, 150, p));
      g.scale(z, z);
      g.translate(-tx, -ty);
      crashScene(g);
      g.restore();
    };
    const p = t >= CUT ? 0 : out(span(t, T0, T1));
    // the last frames of the zoom smear toward the face
    if (p > 0 && p < 1) {
      for (let k = 3; k >= 1; k--) {
        g.globalAlpha = 0.28;
        at(Math.max(0, p - k * 0.09));
      }
      g.globalAlpha = 1;
    }
    // a small jolt as the zoom lands
    const after = t >= T1 && t < CUT ? t - T1 : -1;
    g.save();
    if (after >= 0) {
      const a = 6 * Math.exp(-after * 30);
      g.translate((noise(after * 70, 0, 2) - 0.5) * 2 * a, (noise(after * 70, 4, 5) - 0.5) * 2 * a);
    }
    at(p);
    g.restore();
    // speed lines that flash with the zoom and fade in the hold
    const lines = t >= T0 && t < CUT ? Math.max(0, 1 - Math.max(0, t - T1) / 0.14) * span(t, T0, T1 - 0.02) : 0;
    if (lines > 0) {
      g.strokeStyle = INK;
      g.lineCap = "round";
      for (let k = 0; k < 22; k++) {
        const a = (k / 22) * TAU + rand(k, 9) * 0.2;
        const r0 = 150 + rand(k, 1) * 50, r1 = 260;
        g.globalAlpha = lines * (0.35 + rand(k, 2) * 0.4);
        g.lineWidth = 1.5 + rand(k, 3) * 3;
        g.beginPath();
        g.moveTo(200 + r0 * Math.cos(a), 150 + r0 * Math.sin(a) * 0.8);
        g.lineTo(200 + r1 * Math.cos(a), 150 + r1 * Math.sin(a) * 0.8);
        g.stroke();
      }
      g.globalAlpha = 1;
    }
  },

  // A weight drops on its rope and lands: the whole frame jolts and settles,
  // then the weight is hauled back up.
  "camera-shake": (g, t) => {
    const HIT = 0.3;
    const drop = inCubic(span(t, 0.18, HIT));
    const lift = inOut(span(t, 0.62, 1));
    const bottom = lerp(lerp(70, 214, drop), 70, lift);
    const k = t - HIT;
    const amp = k >= 0 ? 15 * Math.exp(-k * 13) : 0;
    g.save();
    g.translate(200, 150);
    if (amp > 0.05) {
      const q = k * 55;
      g.translate((noise(q, 0, 3) - 0.5) * 2.2 * amp, (noise(q, 5, 7) - 0.5) * 2.2 * amp);
      g.rotate((noise(q, 9, 11) - 0.5) * amp * 0.005);
    }
    g.scale(1.12, 1.12);
    g.translate(-200, -150);
    // the street behind
    fill(g, PAPER);
    g.fillStyle = MIST;
    g.fillRect(-30, 214, W + 60, 120);
    const blds = [[-10, 60, 90], [86, 46, 120], [140, 70, 70], [262, 54, 104], [322, 90, 80]];
    for (const [x, w, h] of blds) rrect(g, x!, 214 - h!, w!, h!, 2, GREY);
    // the rope and the weight
    g.fillStyle = INK_2;
    g.fillRect(198.5, -40, 3, bottom - 64 + 40);
    poly(g, [158, bottom, 242, bottom, 226, bottom - 62, 174, bottom - 62], INK);
    rrect(g, 189, bottom - 72, 22, 12, 4, INK);
    g.fillStyle = PAPER;
    font(g, 22);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("10t", 200, bottom - 29);
    // dust and impact marks
    if (k >= 0 && k < 0.4) {
      const e = out(span(k, 0, 0.4));
      for (let i = 0; i < 7; i++) {
        for (const side of [-1, 1]) {
          const r = 6 + rand(i, side) * 10;
          dot(g, 200 + side * (60 + e * (40 + i * 14)), 210 - e * rand(i, 3, side) * 22, r * (1 - e * 0.6), `rgba(158,162,171,${(1 - e) * 0.8})`);
        }
      }
      const f = span(k, 0, 0.1);
      if (f < 1) {
        g.strokeStyle = KAKI;
        g.lineCap = "round";
        g.lineWidth = 4;
        for (const side of [-1, 1]) {
          for (const a of [0.25, 0.65, 1.05]) {
            const r0 = 56 + f * 30, r1 = r0 + 20 * (1 - f);
            g.beginPath();
            g.moveTo(200 + side * Math.cos(a) * r0, 212 - Math.sin(a) * r0 * 0.7);
            g.lineTo(200 + side * Math.cos(a) * r1, 212 - Math.sin(a) * r1 * 0.7);
            g.stroke();
          }
        }
      }
    }
    g.restore();
  },

  // Four flat layers: the sun stays put, far mountains crawl, the hills move
  // faster and the trees in front rush by.
  parallax: (g, t) => {
    dot(g, 296, 84, 30, KAKI);
    const far = t * 200, mid = t * 400, near = t * 800;
    ridge(g, (x) => 156 - 48 * tri((x + far) / 200) - 16 * tri((x + far) / 100 + 0.3), GREY, 5);
    ridge(g, (x) => {
      const u = ((x + mid) / 400) * TAU;
      return 206 - 18 * Math.sin(u) - 10 * Math.sin(2 * u + 1.2);
    }, GREY_2);
    const nearY = (x: number) => {
      const u = ((x + near) / 400) * TAU;
      return 250 - 10 * Math.sin(u + 0.6) - 6 * Math.sin(2 * u);
    };
    ridge(g, nearY, INK_2);
    // pines on the near layer
    const off = wrap(near, 400);
    for (let k = -1; k <= 1; k++) {
      for (const [x0, sz] of [[70, 1], [110, 0.7], [290, 1.15]] as const) {
        const x = x0 + k * 400 - off;
        if (x < -40 || x > W + 40) continue;
        const y = nearY(x) + 4;
        g.fillStyle = INK;
        g.fillRect(x - 2.5, y - 14 * sz, 5, 14 * sz);
        poly(g, [x, y - 70 * sz, x + 18 * sz, y - 12 * sz, x - 18 * sz, y - 12 * sz], INK);
      }
    }
  },

  // A slow push and pan across a still photo, toward the left face; the
  // thumbnail in the corner shows the part of the photo in frame.
  "ken-burns": (g, t) => {
    const photo = () => {
      g.fillStyle = MIST;
      g.fillRect(0, 0, W, H);
      dot(g, 312, 78, 30, PALE);
      ridge(g, (x) => 190 - 30 * Math.sin(x / 70 + 0.5), GREY);
      g.fillStyle = GREY_2;
      g.fillRect(0, 236, W, 64);
      // two people
      rrect(g, 104, 150, 88, 150, 38, INK_2);
      dot(g, 148, 116, 30, INK_2);
      dot(g, 138, 112, 3, PAPER);
      dot(g, 158, 112, 3, PAPER);
      rrect(g, 220, 196, 64, 110, 28, KAKI);
      dot(g, 252, 168, 22, KAKI);
      // grain: fixed, as a still photo has
      g.fillStyle = "rgba(18,18,18,0.10)";
      for (let i = 0; i < 140; i++) g.fillRect(rand(i, 1) * W, rand(i, 2) * H, 2, 2);
    };
    const frame = (p: number) => {
      const z = lerp(1, 1.45, p);
      const fx = lerp(200, 160, p), fy = lerp(150, 122, p);
      return { z, fx, fy };
    };
    const draw = (p: number) => {
      const { z, fx, fy } = frame(p);
      g.save();
      g.translate(200, 150);
      g.scale(z, z);
      g.translate(-fx, -fy);
      photo();
      g.restore();
    };
    // push in over most of the loop, then dip through white to the start, as
    // a slideshow moves on to its next photo
    const raw = span(t, 0, 0.88);
    const p = lerp(raw, smooth(raw), 0.4);
    const back = t >= 0.94;
    const cur = back ? 0 : p;
    draw(cur);
    const dip = back ? 1 - span(t, 0.94, 1) : span(t, 0.86, 0.94);
    if (dip > 0) {
      g.globalAlpha = smooth(dip);
      fill(g, PAPER);
      g.globalAlpha = 1;
    }
    // the thumbnail with the crop
    const tw = 76, th = 57, tx = W - tw - 14, ty = H - th - 14;
    rrect(g, tx - 3, ty - 3, tw + 6, th + 6, 3, PAPER);
    g.save();
    g.translate(tx, ty);
    g.scale(tw / W, th / H);
    photo();
    g.restore();
    const { z, fx, fy } = frame(cur);
    const cw = (W / z) * (tw / W), ch = (H / z) * (th / H);
    g.strokeStyle = KAKI;
    g.lineWidth = 2;
    g.strokeRect(tx + (fx - W / 2 / z) * (tw / W), ty + (fy - H / 2 / z) * (th / H), cw, ch);
  },

  // The lens zooms in on the doorway and back out, from where the camera
  // stands: the house and the buildings beside it grow together. The focal
  // length counts in the corner.
  zoom: (g, t) => {
    const p = inOut(span(t, 0.1, 0.48)) - inOut(span(t, 0.64, 0.94));
    const z = lerp(1, 2.6, p);
    g.save();
    g.translate(200, 150);
    g.scale(z, z);
    g.translate(-lerp(200, 214, p), -lerp(150, 174, p));
    fill(g, PAPER);
    dot(g, 330, 62, 22, PALE);
    g.fillStyle = MIST;
    g.fillRect(-40, 214, W + 80, 120);
    rrect(g, 18, 96, 70, 118, 2, GREY);
    rrect(g, 96, 130, 40, 84, 2, GREY);
    rrect(g, 306, 80, 78, 134, 2, GREY);
    for (let k = 0; k < 6; k++) rrect(g, 30 + (k % 2) * 26, 108 + Math.floor(k / 2) * 30, 16, 18, 1, PAPER);
    // the house and its door
    rrect(g, 152, 126, 124, 88, 2, GREY_2);
    poly(g, [142, 128, 214, 84, 286, 128], INK_2);
    rrect(g, 166, 142, 24, 24, 1, PAPER);
    rrect(g, 238, 142, 24, 24, 1, PAPER);
    rrect(g, 200, 160, 28, 54, 2, KAKI);
    dot(g, 222, 189, 2, INK);
    g.restore();
    // the viewfinder, which doesn't zoom
    g.strokeStyle = INK;
    g.lineWidth = 3;
    for (const [x, y, sx, sy] of [[16, 16, 1, 1], [384, 16, -1, 1], [16, 284, 1, -1], [384, 284, -1, -1]] as const) {
      g.beginPath();
      g.moveTo(x, y + sy * 22);
      g.lineTo(x, y);
      g.lineTo(x + sx * 22, y);
      g.stroke();
    }
    mono(g, 18);
    g.fillStyle = PAPER;
    g.fillRect(30, 30, 74, 28);
    g.fillStyle = INK;
    g.textAlign = "left";
    g.textBaseline = "alphabetic";
    g.fillText(`${Math.round(lerp(24, 70, p))} mm`, 36, 50);
  },

  // The camera runs alongside the runner, who keeps the middle of the frame;
  // the street streams past behind, the posts in front faster still.
  "tracking-shot": (g, t) => {
    const GY = 236;
    fill(g, PAPER);
    for (let k = 0; k < 6; k++) {
      const x = wrap(k * 80 - t * 480, 480) - 40;
      const h = 50 + rand(k, 1) * 70;
      rrect(g, x, GY - 40 - h, 58, h + 40, 2, GREY);
    }
    g.fillStyle = MIST;
    g.fillRect(0, GY, W, H - GY);
    for (let k = 0; k < 6; k++) rrect(g, wrap(k * 80 - t * 960, 480) - 40, GY + 26, 40, 5, 0, GREY);
    const ph = TAU * t * 4;
    const run: Pose = {
      lean: 0.2,
      armA: Math.sin(ph) * 1.1, elbowA: -1.2,
      armB: -Math.sin(ph) * 1.1, elbowB: -1.2,
      legA: -Math.sin(ph) * 0.8, kneeA: -0.6 - 0.5 * Math.max(0, Math.sin(ph)),
      legB: Math.sin(ph) * 0.8, kneeB: -0.6 - 0.5 * Math.max(0, -Math.sin(ph)),
    };
    figure(g, 196, GY - Math.abs(Math.sin(ph)) * 5, 1.25, run);
    // posts between the camera and the runner
    for (let k = 0; k < 3; k++) {
      const x = wrap(k * 200 - t * 1800, 600) - 50;
      g.fillStyle = INK;
      g.fillRect(x, 120, 12, H - 120);
    }
  },

  // The camera rises from behind the hedge: the hedge drops out of the
  // bottom of the frame, the city behind comes up into view and sinks only a
  // little. The gauge on the left shows the height.
  crane: (g, t) => {
    const p = inOut(span(t, 0.08, 0.56)) - inOut(span(t, 0.7, 0.96));
    fill(g, PAPER);
    g.save();
    g.translate(0, p * 70);
    dot(g, 300, 54, 22, PALE);
    const towers = [[40, 46, 60], [92, 34, 96], [132, 50, 70], [190, 30, 128], [226, 44, 84], [276, 38, 104], [320, 56, 66]];
    for (const [x, w, h] of towers) rrect(g, x!, 190 - h!, w!, h!, 2, GREY);
    rrect(g, 196, 40, 18, 150, 2, KAKI);
    g.fillStyle = GREY_2;
    g.fillRect(-10, 190, W + 20, 8);
    g.fillStyle = MIST;
    g.fillRect(-10, 198, W + 20, 200);
    g.restore();
    // the hedge, near the camera, drops much further
    g.save();
    g.translate(0, p * 250);
    g.fillStyle = INK_2;
    g.beginPath();
    g.moveTo(-10, H + 10);
    for (let x = -10; x <= W + 10; x += 6) g.lineTo(x, 112 - 8 * Math.abs(Math.sin(x / 22)) - 5 * Math.sin(x / 9));
    g.lineTo(W + 10, H + 10);
    g.closePath();
    g.fill();
    g.restore();
    // the height gauge
    g.fillStyle = PAPER;
    g.fillRect(14, 60, 14, 180);
    g.fillStyle = GREY_2;
    g.fillRect(20, 66, 2, 168);
    rrect(g, 14, 226 - p * 156, 14, 8, 2, KAKI);
  },

  // Someone is holding the camera: the shot drifts and sways and never quite
  // settles. The viewfinder marks stay still, to show it.
  handheld: (g, t) => {
    const dx = (loopNoise(t, 1, 1.4) - 0.5) * 26 + (loopNoise(t, 4, 5) - 0.5) * 3;
    const dy = (loopNoise(t, 2, 1.4) - 0.5) * 18 + (loopNoise(t, 5, 5) - 0.5) * 3;
    const a = (loopNoise(t, 3, 1.4) - 0.5) * 0.06;
    g.save();
    g.translate(200 + dx, 150 + dy);
    g.rotate(a);
    g.scale(1.14, 1.14);
    g.translate(-200, -150);
    fill(g, PAPER);
    // a window and a table
    rrect(g, 220, 40, 150, 120, 2, MIST);
    g.fillStyle = GREY;
    g.fillRect(293, 40, 4, 120);
    g.fillRect(220, 98, 150, 4);
    // someone across the table
    rrect(g, 96, 128, 104, 120, 46, INK_2);
    dot(g, 148, 102, 30, INK);
    g.fillStyle = GREY_2;
    g.fillRect(0, 214, W, 90);
    // the cup and its steam
    rrect(g, 226, 178, 40, 40, 6, KAKI);
    g.strokeStyle = KAKI;
    g.lineWidth = 5;
    g.beginPath();
    g.arc(268, 196, 10, -1.2, 1.2);
    g.stroke();
    g.strokeStyle = GREY;
    g.lineWidth = 3;
    g.lineCap = "round";
    for (const x of [238, 254]) {
      g.beginPath();
      for (let y = 168; y > 128; y -= 4) g.lineTo(x + 4 * Math.sin(y / 7 + TAU * t * 2), y);
      g.stroke();
    }
    g.restore();
    g.strokeStyle = PAPER;
    g.lineWidth = 3;
    for (const [x, y, sx, sy] of [[16, 16, 1, 1], [384, 16, -1, 1], [16, 284, 1, -1], [384, 284, -1, -1]] as const) {
      g.beginPath();
      g.moveTo(x, y + sy * 22);
      g.lineTo(x, y);
      g.lineTo(x + sx * 22, y);
      g.stroke();
    }
    dot(g, 34, 34, 6, KAKI);
  },

  // Low and fast over the field: the stripes and posts rush at the camera,
  // which banks left and right as it weaves; the tower waits on the horizon.
  fpv: (g, t) => {
    const bank = Math.sin(TAU * t) * 0.3;
    const side = Math.sin(TAU * t) * 34;
    const HZ = 118, F = 220, CAM = 22;
    const sy = (z: number, y: number) => HZ + (F * (CAM - y)) / z;
    const sx = (z: number, x: number) => 200 + (F * (x - side)) / z;
    g.save();
    g.translate(200, 150);
    g.rotate(bank);
    g.translate(-200, -150);
    g.fillStyle = PAPER;
    g.fillRect(-200, -200, W + 400, HZ + 200);
    g.fillStyle = MIST;
    g.fillRect(-200, HZ, W + 400, H + 200);
    // stripes across the field, nearest last
    const D = 240;
    for (let k = 11; k >= 0; k--) {
      const z0 = wrap(k * 20 - t * 480, D) + 4;
      const z1 = z0 + 10;
      g.fillStyle = GREY;
      g.fillRect(-200, sy(z1, 0), W + 400, Math.max(0.5, sy(z0, 0) - sy(z1, 0)));
    }
    // the tower, far off
    rrect(g, sx(4000, 80) - 7, HZ - 70, 14, 70, 2, KAKI);
    // the posts, left and right of the path, nearest last
    const posts: { z: number; x: number }[] = [];
    for (let k = 0; k < 8; k++) posts.push({ z: wrap(k * 30 - t * 480, D) + 4, x: k % 2 ? 46 : -46 });
    posts.sort((a, b) => b.z - a.z);
    for (const { z, x } of posts) {
      const w = (F * 4) / z;
      const top = sy(z, 34), bot = sy(z, 0);
      g.globalAlpha = clamp((D - z) / 40);
      g.fillStyle = INK;
      g.fillRect(sx(z, x) - w / 2, top, w, bot - top);
      g.globalAlpha = 1;
    }
    g.restore();
  },

  // The corridor tips over to a slant and back. The dashed line is level, to
  // measure the tilt against.
  "dutch-angle": (g, t) => {
    const a = (inOut(span(t, 0.12, 0.34)) - inOut(span(t, 0.66, 0.9))) * 0.26;
    const s = Math.cos(a) + Math.sin(Math.abs(a)) * (W / H);
    g.save();
    g.translate(200, 150);
    g.rotate(a);
    g.scale(s, s);
    g.translate(-200, -150);
    fill(g, MIST);
    poly(g, [0, 0, 400, 0, 250, 96, 150, 96], GREY);
    poly(g, [0, 300, 400, 300, 250, 196, 150, 196], GREY_2);
    poly(g, [0, 0, 150, 96, 150, 196, 0, 300], PAPER);
    poly(g, [400, 0, 250, 96, 250, 196, 400, 300], PAPER);
    // doors along the walls
    poly(g, [40, 112, 84, 116, 84, 222, 40, 244], GREY);
    poly(g, [360, 112, 316, 116, 316, 222, 360, 244], GREY);
    poly(g, [108, 128, 128, 129, 128, 210, 108, 220], GREY);
    // the door at the end, and someone standing in front of it
    rrect(g, 184, 120, 32, 76, 1, KAKI);
    figure(g, 160, 214, 0.55, { armA: 0.12, armB: -0.12, legA: 0.08, legB: -0.08 });
    g.restore();
    g.strokeStyle = INK;
    g.lineWidth = 2;
    g.setLineDash([8, 8]);
    g.beginPath();
    g.moveTo(0, 150);
    g.lineTo(W, 150);
    g.stroke();
    g.setLineDash([]);
    mono(g, 18);
    g.fillStyle = INK;
    g.textAlign = "left";
    g.textBaseline = "alphabetic";
    g.fillText(`${Math.round((a * 180) / Math.PI)}°`, 22, 40);
  },
};
