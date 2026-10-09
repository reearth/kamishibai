// Shape: how each term's loop is drawn. See kit.ts.
// After Effects shape-layer moves, drawn as clean vector strokes.
import { INK, KAKI, KAKI_2, GREY, PAPER, TAU, W, H, clamp, lerp, span, inOut, out, smooth, wrap, mix, loopNoise, dot, type Paint, type Shapes } from "./kit.ts";

export const SHAPES: Record<string, Shapes> = {};

const CX = W / 2, CY = H / 2;
type Pt = [number, number];

// ---- helpers ----

/** Sample a curve s ∈ [0, 1] → point into a polyline with its running length. */
function polyline(f: (s: number) => Pt, n: number): { pts: Pt[]; len: number[] } {
  const pts: Pt[] = [], len: number[] = [];
  for (let i = 0; i <= n; i++) {
    const p = f(i / n);
    const q = pts[i - 1];
    len.push(q ? (len[i - 1] ?? 0) + Math.hypot(p[0] - q[0], p[1] - q[1]) : 0);
    pts.push(p);
  }
  return { pts, len };
}

/** Stroke the part of a polyline between fractions a and b of its length: a trim path. */
function strokeTrim(g: CanvasRenderingContext2D, pl: { pts: Pt[]; len: number[] }, a: number, b: number): void {
  const total = pl.len[pl.len.length - 1] ?? 0;
  const la = clamp(a) * total, lb = clamp(b) * total;
  if (lb - la < 0.5) return;
  const at = (d: number): Pt => {
    let i = 1;
    while (i < pl.len.length - 1 && (pl.len[i] ?? 0) < d) i++;
    const l0 = pl.len[i - 1] ?? 0, l1 = pl.len[i] ?? 0;
    const p0 = pl.pts[i - 1] ?? [0, 0], p1 = pl.pts[i] ?? [0, 0];
    const f = l1 > l0 ? (d - l0) / (l1 - l0) : 0;
    return [lerp(p0[0], p1[0], f), lerp(p0[1], p1[1], f)];
  };
  g.beginPath();
  const s = at(la);
  g.moveTo(s[0], s[1]);
  pl.pts.forEach((p, i) => {
    const d = pl.len[i] ?? 0;
    if (d > la && d < lb) g.lineTo(p[0], p[1]);
  });
  const e = at(lb);
  g.lineTo(e[0], e[1]);
  g.stroke();
}

function tracePts(g: CanvasRenderingContext2D, pts: Pt[], close = true): void {
  g.beginPath();
  pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
  if (close) g.closePath();
}

/** Corners of a regular star or polygon round (cx, cy), the first one pointing up. */
function starPts(cx: number, cy: number, n: number, ro: number, ri: number, rot = 0): Pt[] {
  const pts: Pt[] = [];
  const k = ri === ro ? n : n * 2;
  for (let i = 0; i < k; i++) {
    const a = -Math.PI / 2 + rot + (i * TAU) / k;
    const r = ri === ro || i % 2 === 0 ? ro : ri;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

/** n points spaced evenly along a closed polygon, starting at its first corner. */
function resample(poly: Pt[], n: number): Pt[] {
  const closed = [...poly, poly[0] ?? [0, 0]];
  const pl = { pts: closed, len: [0] as number[] };
  for (let i = 1; i < closed.length; i++) {
    const a = closed[i - 1] ?? [0, 0], b = closed[i] ?? [0, 0];
    pl.len.push((pl.len[i - 1] ?? 0) + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = pl.len[pl.len.length - 1] ?? 1;
  const out: Pt[] = [];
  let i = 1;
  for (let j = 0; j < n; j++) {
    const d = (j / n) * total;
    while (i < pl.len.length - 1 && (pl.len[i] ?? 0) < d) i++;
    const l0 = pl.len[i - 1] ?? 0, l1 = pl.len[i] ?? 0;
    const p0 = closed[i - 1] ?? [0, 0], p1 = closed[i] ?? [0, 0];
    const f = l1 > l0 ? (d - l0) / (l1 - l0) : 0;
    out.push([lerp(p0[0], p1[0], f), lerp(p0[1], p1[1], f)]);
  }
  return out;
}

// ---- metaballs ----
const MB_N = 80, MB_M = 60, MB_S = W / MB_N;
const field = new Float32Array((MB_N + 1) * (MB_M + 1));

export const PAINT: Record<string, Paint> = {
  "trim-paths": (g, t) => {
    // A looped cursive line (a prolate cycloid): draw on, hold, chase off.
    const pl = polyline((s) => {
      const th = Math.PI + s * 4 * Math.PI;
      return [62 + 22 * (th - Math.PI) - 50 * Math.sin(th), 158 - 54 * Math.cos(th)];
    }, 240);
    g.lineCap = "round";
    g.lineJoin = "round";
    g.strokeStyle = GREY;
    g.lineWidth = 2;
    g.setLineDash([2, 6]);
    strokeTrim(g, pl, 0, 1);
    g.setLineDash([]);
    const end = inOut(span(t, 0.04, 0.46));
    const start = inOut(span(t, 0.56, 0.94));
    g.strokeStyle = KAKI;
    g.lineWidth = 14;
    strokeTrim(g, pl, start, end);
  },

  "stroke-width": (g, t) => {
    // Three rings breathing in turn; the middle one carries the accent.
    [0, 1, 2].forEach((k) => {
      const p = inOut(0.5 - 0.5 * Math.cos(TAU * wrap(t - k * 0.09, 1)));
      g.strokeStyle = k === 1 ? KAKI : INK;
      g.lineWidth = 3 + p * 25;
      g.beginPath();
      g.arc(CX, CY, 34 + k * 40, 0, TAU);
      g.stroke();
    });
  },

  "shape-morph": (g, t) => {
    // Every shape is resampled to the same number of points by arc length,
    // starting at its top and running clockwise, so point j morphs to point j.
    const R = 84, N = 200, sq = 72;
    const circle: Pt[] = Array.from({ length: 120 }, (_, j) => {
      const a = -Math.PI / 2 + (j / 120) * TAU;
      return [R * Math.cos(a), R * Math.sin(a)] as Pt;
    });
    const square: Pt[] = [[0, -sq], [sq, -sq], [sq, sq], [-sq, sq], [-sq, -sq]];
    const star = starPts(0, 0, 5, R * 1.14, R * 0.47);
    const shapes = [circle, square, star].map((poly) => resample(poly, N));
    const seg = t * 3;
    const i = Math.floor(seg) % 3;
    const p = inOut(span(seg - Math.floor(seg), 0.32, 0.88));
    const from = shapes[i] ?? [], to = shapes[(i + 1) % 3] ?? [];
    const pts = from.map((a, j): Pt => {
      const b = to[j] ?? a;
      return [CX + lerp(a[0], b[0], p), CY + 6 + lerp(a[1], b[1], p)];
    });
    tracePts(g, pts);
    g.fillStyle = KAKI;
    g.fill();
  },

  repeater: (g, t) => {
    const n = 12;
    const fan = inOut(span(t, 0.06, 0.42)) - inOut(span(t, 0.6, 0.94));
    const step = fan * (TAU / n);
    for (let i = n - 1; i >= 0; i--) {
      const s = 1 - i * 0.04 * fan;
      g.save();
      g.translate(CX, CY);
      g.rotate(i * step);
      g.scale(s, s);
      g.beginPath();
      g.ellipse(0, -66, 17, 50, 0, 0, TAU);
      g.fillStyle = i === 0 ? KAKI : mix(INK, PAPER, (i / n) * 0.75);
      g.fill();
      g.restore();
    }
    dot(g, CX, CY, 5, PAPER);
  },

  "offset-paths": (g, t) => {
    const star = starPts(CX, CY + 6, 5, 50, 22);
    g.lineJoin = "round";
    const gap = 22, n = 6;
    // Widest first; each ring is an ink band with a paper band over it.
    for (let k = n - 1; k >= 0; k--) {
      const d = (k + t) * gap;
      if (d < 1.5) continue;
      const fade = clamp(d / 12) * (1 - smooth(span(d, gap * 1.2, gap * (n - 0.6))));
      tracePts(g, star);
      g.lineWidth = 2 * d + 4;
      g.strokeStyle = mix(PAPER, INK, fade);
      g.stroke();
      g.lineWidth = 2 * d - 4;
      g.strokeStyle = PAPER;
      g.stroke();
    }
    tracePts(g, star);
    g.fillStyle = KAKI;
    g.fill();
  },

  "wiggle-paths": (g, t) => {
    const base = starPts(0, 0, 6, 92, 92);
    // Subdivide the hexagon, then push each point along its normal by looping noise.
    const pts: Pt[] = [];
    const per = 5;
    base.forEach((p, i) => {
      const q = base[(i + 1) % base.length] ?? p;
      for (let k = 0; k < per; k++) {
        const f = k / per;
        const x = lerp(p[0], q[0], f), y = lerp(p[1], q[1], f);
        const j = i * per + k;
        const a = Math.atan2(y, x);
        const off = (loopNoise(t, j * 3.1, 1.6) - 0.5) * 22;
        const side = (loopNoise(t, j * 3.1 + 50, 1.6) - 0.5) * 6;
        pts.push([CX + x + off * Math.cos(a) - side * Math.sin(a), CY + y + off * Math.sin(a) + side * Math.cos(a)]);
      }
    });
    tracePts(g, starPts(CX, CY, 6, 92, 92));
    g.strokeStyle = GREY;
    g.lineWidth = 2;
    g.setLineDash([2, 6]);
    g.lineCap = "round";
    g.stroke();
    g.setLineDash([]);
    tracePts(g, pts);
    g.lineJoin = "round";
    g.strokeStyle = KAKI;
    g.lineWidth = 9;
    g.stroke();
  },

  "pucker-and-bloat": (g, t) => {
    const n = 6, R = 86;
    const v = starPts(CX, CY, n, R, R, Math.PI / n);
    // Pucker (−) for the first half, bloat (+) for the second, holding at each extreme.
    const amt = -Math.sin(TAU * t);
    const a = Math.sign(amt) * Math.pow(Math.abs(amt), 0.55);
    const k = a < 0 ? 1 + a * 0.95 : 1 + a * 0.7;
    const ctrl = (p: Pt): Pt => [CX + (p[0] - CX) * k, CY + (p[1] - CY) * k];
    g.beginPath();
    v.forEach((p, i) => {
      const q = v[(i + 1) % n] ?? p;
      const c1 = ctrl([lerp(p[0], q[0], 1 / 3), lerp(p[1], q[1], 1 / 3)]);
      const c2 = ctrl([lerp(p[0], q[0], 2 / 3), lerp(p[1], q[1], 2 / 3)]);
      if (i === 0) g.moveTo(p[0], p[1]);
      g.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], q[0], q[1]);
    });
    g.closePath();
    g.fillStyle = KAKI;
    g.fill();
    tracePts(g, v);
    g.strokeStyle = GREY;
    g.lineWidth = 2;
    g.setLineDash([2, 6]);
    g.lineCap = "round";
    g.stroke();
    g.setLineDash([]);
    v.forEach((p) => {
      dot(g, p[0], p[1], 6, PAPER);
      g.strokeStyle = INK;
      g.lineWidth = 2.5;
      g.beginPath();
      g.arc(p[0], p[1], 6, 0, TAU);
      g.stroke();
    });
  },

  "marching-ants": (g, t) => {
    // A route from a start ring to a pin; the dashes flow toward the pin.
    const ax = 76, ay = 214, bx = 324, by = 92;
    g.beginPath();
    g.moveTo(ax, ay);
    g.bezierCurveTo(170, 300, 190, 30, 250, 150);
    g.bezierCurveTo(275, 200, 330, 170, bx, by + 24);
    g.lineCap = "round";
    g.lineWidth = 9;
    g.strokeStyle = KAKI;
    g.setLineDash([16, 14]);
    g.lineDashOffset = -t * 30 * 4;
    g.stroke();
    g.setLineDash([]);
    // start
    dot(g, ax, ay, 15, INK);
    dot(g, ax, ay, 6, PAPER);
    // pin
    g.fillStyle = INK;
    g.beginPath();
    g.arc(bx, by - 6, 20, Math.PI * 0.82, Math.PI * 0.18);
    g.lineTo(bx, by + 30);
    g.closePath();
    g.fill();
    dot(g, bx, by - 6, 8, PAPER);
  },

  burst: (g, t) => {
    const n = 12;
    // Anticipation dip, then the button kicks and the rays fire.
    const dip = span(t, 0.08, 0.2), kick = span(t, 0.2, 0.5);
    const s = 1 - 0.18 * Math.sin(Math.PI * dip) * (1 - kick) + 0.16 * Math.sin(Math.PI * kick) * (1 - kick);
    g.lineCap = "round";
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i * TAU) / n;
      const long = i % 2 === 0;
      const r0 = 44, r1 = long ? 128 : 100;
      const d = (i % 3) * 0.015;
      const head = out(span(t, 0.2 + d, 0.48 + d));
      const tail = out(span(t, 0.28 + d, 0.66 + d));
      const pl = polyline((u) => [CX + Math.cos(a) * lerp(r0, r1, u), CY + Math.sin(a) * lerp(r0, r1, u)], 1);
      g.strokeStyle = long ? KAKI : INK;
      g.lineWidth = long ? 9 : 6;
      strokeTrim(g, pl, tail, head);
      if (!long) {
        const pop = span(t, 0.38 + d, 0.76 + d);
        if (pop > 0 && pop < 1) dot(g, CX + Math.cos(a) * (r1 + 16), CY + Math.sin(a) * (r1 + 16), 6 * Math.sin(Math.PI * Math.sqrt(pop)), KAKI_2);
      }
    }
    dot(g, CX, CY, 30 * s, KAKI);
    // a heart on the button
    g.save();
    g.translate(CX, CY + 2);
    g.scale(s, s);
    g.fillStyle = PAPER;
    g.beginPath();
    g.moveTo(0, 10);
    g.bezierCurveTo(-16, -1, -12, -15, 0, -7);
    g.bezierCurveTo(12, -15, 16, -1, 0, 10);
    g.fill();
    g.restore();
  },

  metaballs: (g, t) => {
    // Two blobs meet in the middle and part; a small one orbits through them.
    const c = 0.5 + 0.5 * Math.cos(TAU * t);
    const sep = 22 + 96 * inOut(c);
    const balls: [number, number, number][] = [
      [CX - sep, CY, 48],
      [CX + sep, CY, 40],
      [CX + 120 * Math.cos(TAU * t + 1), CY + 70 * Math.sin(TAU * t * 2), 22],
    ];
    for (let j = 0; j <= MB_M; j++) {
      for (let i = 0; i <= MB_N; i++) {
        const x = i * MB_S, y = j * MB_S;
        let f = 0;
        for (const [bx, by, r] of balls) f += (r * r) / ((x - bx) ** 2 + (y - by) ** 2 + 1);
        field[j * (MB_N + 1) + i] = f;
      }
    }
    const T = 1;
    // Marching squares: each cell adds the polygon of its inside part, all in one clockwise path.
    g.beginPath();
    for (let j = 0; j < MB_M; j++) {
      let run = -1;
      for (let i = 0; i < MB_N; i++) {
        const v = [
          field[j * (MB_N + 1) + i] ?? 0,
          field[j * (MB_N + 1) + i + 1] ?? 0,
          field[(j + 1) * (MB_N + 1) + i + 1] ?? 0,
          field[(j + 1) * (MB_N + 1) + i] ?? 0,
        ];
        const inside = v.map((f) => f >= T);
        const full = inside.every(Boolean);
        if (full) {
          if (run < 0) run = i;
          continue;
        }
        if (run >= 0) {
          g.rect(run * MB_S, j * MB_S, (i - run) * MB_S, MB_S);
          run = -1;
        }
        if (!inside.some(Boolean)) continue;
        const corner: Pt[] = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
        const poly: Pt[] = [];
        for (let k = 0; k < 4; k++) {
          const p = corner[k] ?? [0, 0], q = corner[(k + 1) % 4] ?? [0, 0];
          const fp = v[k] ?? 0, fq = v[(k + 1) % 4] ?? 0;
          if (fp >= T) poly.push([p[0] * MB_S, p[1] * MB_S]);
          if (fp >= T !== fq >= T) {
            const f = (T - fp) / (fq - fp);
            poly.push([lerp(p[0], q[0], f) * MB_S, lerp(p[1], q[1], f) * MB_S]);
          }
        }
        poly.forEach((p, k) => (k ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
        g.closePath();
      }
      if (run >= 0) g.rect(run * MB_S, j * MB_S, (MB_N - run) * MB_S, MB_S);
    }
    g.fillStyle = KAKI;
    g.fill();
  },
};
