// Motion: how each term's loop is drawn. See kit.ts.
import {
  INK, PAPER, KAKI, PALE, GREY, GREY_2, MIST, W, H, TAU,
  clamp, span, inOut, out, inCubic, pingPong, wrap, loopNoise, rect, circle, ground, dot, font,
  type Paint, type Shapes,
} from "./kit.ts";

export const SHAPES: Record<string, Shapes> = {
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
};

// ---- helpers for the paints below ----

/** The loop's body move for follow-through: right in the first half, back in the second, each held after. */
function bodyX(t: number): number {
  const u = wrap(t, 1);
  return u < 0.5 ? 110 + 180 * inOut(span(u, 0.04, 0.24)) : 290 - 180 * inOut(span(u, 0.54, 0.74));
}

/**
 * Two damped springs dragged by the body's acceleration, integrated from one loop
 * before t, so the state at t = 1 is the state at t = 0 (the swings have died out).
 */
function lagAngles(t: number): [number, number] {
  const dt = 0.002, h = 0.002;
  const springs = [
    { k: 2700, c: 20, m: 0.05, a: 0, v: 0 },
    { k: 1500, c: 14, m: 0.06, a: 0, v: 0 },
  ];
  for (let s = t - 1; s < t; s += dt) {
    const acc = (bodyX(s + h) - 2 * bodyX(s) + bodyX(s - h)) / (h * h);
    for (const p of springs) {
      p.v += (-p.k * p.a - p.c * p.v - p.m * acc) * dt;
      p.a += p.v * dt;
    }
  }
  return [springs[0]!.a, springs[1]!.a];
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/** The bounce: dropped from above the frame, each bounce 0.36 as high as the last. */
const BOUNCE = (() => {
  const h0 = 250, r = 0.36;
  const parts: { d: number; h: number }[] = [];
  let total = Math.sqrt(h0);
  for (let n = 1; n < 9; n++) {
    const h = h0 * Math.pow(r, n);
    parts.push({ d: 2 * Math.sqrt(h), h });
    total += 2 * Math.sqrt(h);
  }
  /** height above the ground at time τ (τ in √px) */
  const height = (tau: number): number => {
    const fall = Math.sqrt(h0);
    if (tau < fall) return h0 - tau * tau;
    let s = tau - fall;
    for (const p of parts) {
      if (s < p.d) return s * (p.d - s);
      s -= p.d;
    }
    return 0;
  };
  return { total, height };
})();

export const PAINT: Record<string, Paint> = {
  "follow-through": (g, t) => {
    const x = bodyX(t);
    const [a1, a2] = lagAngles(t);
    const gy = 236;
    g.fillStyle = MIST;
    g.fillRect(0, gy, W, H - gy);
    // the body: it stops dead
    g.fillStyle = KAKI;
    roundRect(g, x - 40, gy - 62, 80, 62, 14);
    g.fill();
    // the loose parts: they keep going, swing back and settle
    g.lineCap = "round";
    [[x - 16, a1, 78], [x + 16, a2, 64]].forEach(([bx, a, L]) => {
      const by = gy - 62;
      const tx = bx! + L! * Math.sin(a!), ty = by - L! * Math.cos(a!);
      const cx = bx! + L! * 0.55 * Math.sin(a! * 0.35), cy = by - L! * 0.55 * Math.cos(a! * 0.35);
      g.strokeStyle = INK;
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(bx!, by);
      g.quadraticCurveTo(cx, cy, tx, ty);
      g.stroke();
      dot(g, tx, ty, 9, INK);
    });
  },

  bounce: (g, t) => {
    const gy = 244, r = 17;
    const fade = 1 - span(t, 0.86, 0.96);
    const xAt = (tau: number) => 70 + 250 * (tau / BOUNCE.total);
    const tauNow = span(t, 0, 0.74) * BOUNCE.total;
    g.fillStyle = MIST;
    g.fillRect(0, gy, W, H - gy);
    g.globalAlpha = fade;
    // the path so far: each arc lower than the last
    for (let tau = 0; tau < tauNow; tau += 0.7) dot(g, xAt(tau), gy - r - BOUNCE.height(tau), 2.2, GREY_2);
    const h = BOUNCE.height(tauNow);
    const squash = Math.max(0, 1 - h / 6) * 0.28 * clamp(1 - tauNow / BOUNCE.total) * 1.6;
    g.save();
    g.translate(xAt(tauNow), gy);
    g.scale(1 + squash, 1 - squash);
    dot(g, 0, -r - h / (1 - squash), r, KAKI);
    g.restore();
    g.globalAlpha = 1;
  },

  elastic: (g, t) => {
    const u = span(t, 0.06, 0.62);
    let s = u <= 0 ? 0 : 1 - Math.exp(-4 * u) * Math.cos(TAU * 3.5 * u);
    s *= 1 - inCubic(span(t, 0.82, 0.95));
    const cx = 200, cy = 150, R = 60;
    g.setLineDash([6, 7]);
    g.strokeStyle = GREY_2;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(cx, cy, R, 0, TAU);
    g.stroke();
    g.setLineDash([]);
    dot(g, cx, cy, R * Math.max(0, s), KAKI);
  },

  wiggle: (g, t) => {
    const at = (tt: number) => ({
      x: 200 + (loopNoise(tt, 11, 1.6) - 0.5) * 230,
      y: 150 + (loopNoise(tt, 23, 1.6) - 0.5) * 170,
      a: (loopNoise(tt, 37, 1.6) - 0.5) * 1.6,
    });
    // where it rests, and where it has just been
    g.strokeStyle = GREY;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(186, 150); g.lineTo(214, 150);
    g.moveTo(200, 136); g.lineTo(200, 164);
    g.stroke();
    g.lineCap = "round";
    g.lineWidth = 2.5;
    const n = 36;
    for (let k = n; k > 0; k--) {
      const a = at(t - k * 0.004), b = at(t - (k - 1) * 0.004);
      g.strokeStyle = INK;
      g.globalAlpha = 0.45 * (1 - k / n);
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
    }
    g.globalAlpha = 1;
    const p = at(t);
    g.save();
    g.translate(p.x, p.y);
    g.rotate(p.a);
    g.fillStyle = KAKI;
    roundRect(g, -26, -26, 52, 52, 9);
    g.fill();
    g.restore();
  },

  "on-twos": (g, t) => {
    const x = (tt: number) => 80 + 240 * inOut(pingPong(wrap(tt, 1)));
    const STEP = 1 / 20;
    const held = Math.floor(t / STEP) * STEP;
    const lanes = [96, 204];
    g.strokeStyle = GREY;
    g.lineWidth = 1.5;
    for (const y of lanes) {
      g.beginPath();
      g.moveTo(60, y + 40);
      g.lineTo(340, y + 40);
      g.stroke();
    }
    font(g, 15, 600);
    g.fillStyle = GREY_2;
    g.fillText("smooth", 60, lanes[0]! - 34);
    g.fillText("stepped", 60, lanes[1]! - 34);
    // smooth: a continuous smear behind it
    for (let k = 12; k > 0; k--) {
      g.globalAlpha = 0.1 * (1 - k / 12);
      dot(g, x(t - k * 0.006), lanes[0]!, 22, INK);
    }
    // stepped: the drawings it held, each one a jump
    for (let k = 3; k > 0; k--) {
      g.globalAlpha = 0.12 * (1 - k / 4);
      dot(g, x(held - k * STEP), lanes[1]!, 22, INK);
    }
    g.globalAlpha = 1;
    dot(g, x(t), lanes[0]!, 22, INK);
    dot(g, x(held), lanes[1]!, 22, KAKI);
  },

  "sine-wave": (g, t) => {
    const n = 13, x0 = 50, dx = 25, A = 46, k = 0.42;
    const y = (x: number) => 150 + A * Math.sin(TAU * t - ((x - x0) / dx) * k);
    g.strokeStyle = GREY;
    g.lineWidth = 2;
    g.beginPath();
    for (let x = x0; x <= x0 + dx * (n - 1); x += 3) x === x0 ? g.moveTo(x, y(x)) : g.lineTo(x, y(x));
    g.stroke();
    for (let i = 0; i < n; i++) {
      const x = x0 + i * dx;
      dot(g, x, y(x), i === 6 ? 11 : 8, i === 6 ? KAKI : INK);
    }
  },

  "motion-path": (g, t) => {
    const P = (u: number) => ({ x: 200 + 140 * Math.sin(TAU * u), y: 150 + 72 * Math.sin(2 * TAU * u) });
    // the path, with its keyframes
    g.setLineDash([2, 7]);
    g.lineCap = "round";
    g.strokeStyle = GREY_2;
    g.lineWidth = 2.5;
    g.beginPath();
    for (let i = 0; i <= 120; i++) {
      const p = P(i / 120);
      i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y);
    }
    g.stroke();
    g.setLineDash([]);
    for (const u of [0.125, 0.375, 0.625, 0.875]) {
      const p = P(u);
      g.fillStyle = PAPER;
      g.strokeStyle = INK;
      g.lineWidth = 2;
      g.fillRect(p.x - 5, p.y - 5, 10, 10);
      g.strokeRect(p.x - 5, p.y - 5, 10, 10);
    }
    // the object, turned to face along the path
    const p = P(t), q = P(t + 0.002);
    g.save();
    g.translate(p.x, p.y);
    g.rotate(Math.atan2(q.y - p.y, q.x - p.x));
    g.fillStyle = KAKI;
    g.beginPath();
    g.moveTo(30, 0);
    g.lineTo(-20, -20);
    g.lineTo(-10, 0);
    g.lineTo(-20, 20);
    g.closePath();
    g.fill();
    g.restore();
  },

  "motion-blur": (g, t) => {
    const x = (tt: number) => {
      const u = wrap(tt, 1);
      return u < 0.5 ? 90 + 220 * inOut(span(u, 0.12, 0.38)) : 310 - 220 * inOut(span(u, 0.62, 0.88));
    };
    g.fillStyle = MIST;
    g.fillRect(0, 214, W, H - 214);
    // the shutter is open for a moment: average the ball over it
    const N = 24, S = 0.05, a = 1 - Math.pow(0.02, 1 / N);
    g.globalAlpha = a;
    for (let i = 0; i < N; i++) dot(g, x(t + S * (i / (N - 1) - 0.5)), 150, 34, KAKI);
    g.globalAlpha = 1;
  },
};
