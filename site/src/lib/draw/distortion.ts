// Distortion: how each term's loop is drawn. See kit.ts.
// Most of these sample a plain source (grid, stripes, checker, bars) through a
// displacement function on a coarse mesh: the mesh points move, and the shapes
// are drawn through them, never pixel by pixel.
import {
  W, H, TAU, INK, INK_2, PAPER, KAKI, PALE, GREY_2,
  clamp, lerp, span, inOut, inCubic, out, smooth, pingPong, wrap, noise, dot, font,
  type Paint, type Shapes,
} from "./kit.ts";

export const SHAPES: Record<string, Shapes> = {};

type Pt = [number, number];
type Map2 = (x: number, y: number) => Pt;

/** Grid lines of the source rectangle, drawn through map with `sub` points per cell. */
function warpedGrid(g: CanvasRenderingContext2D, map: Map2, x0: number, y0: number, x1: number, y1: number, step: number, sub = 4): void {
  g.beginPath();
  const d = step / sub;
  for (let x = x0; x <= x1 + 0.01; x += step) {
    for (let y = y0, i = 0; y <= y1 + 0.01; y += d, i++) {
      const [px, py] = map(x, y);
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
  }
  for (let y = y0; y <= y1 + 0.01; y += step) {
    for (let x = x0, i = 0; x <= x1 + 0.01; x += d, i++) {
      const [px, py] = map(x, y);
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
  }
  g.stroke();
}

/** A closed outline sampled at n points, each pushed through map. */
function warpedLoop(g: CanvasRenderingContext2D, n: number, at: (u: number) => Pt, map: Map2): void {
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const [x, y] = at(i / n);
    const [px, py] = map(x, y);
    if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
  }
  g.closePath();
}

/** In, hold, out, hold: 0 → 1 between a and b, back to 0 between c and d. */
const inHoldOut = (t: number, a: number, b: number, c: number, d: number) =>
  t < c ? inOut(span(t, a, b)) : 1 - inOut(span(t, c, d));

/** A canvas reused as a buffer, grown when a bigger one is needed and fully redrawn by each call. */
let buffer: HTMLCanvasElement | undefined;
function scratch(w: number, h: number): HTMLCanvasElement {
  buffer ??= document.createElement("canvas");
  if (buffer.width < w) buffer.width = w;
  if (buffer.height < h) buffer.height = h;
  return buffer;
}

export const PAINT: Record<string, Paint> = {
  twirl: (g, t) => {
    // A checker sheet; points turn about the centre by an angle that grows
    // towards it. One row is orange so the curl of a straight line shows.
    const cx = W / 2, cy = H / 2, R = 170, n = 12, cell = 20, sub = 3;
    const x0 = cx - (n * cell) / 2, y0 = cy - (n * cell) / 2;
    const amt = inHoldOut(t, 0.06, 0.42, 0.56, 0.94) * TAU * 0.9;
    const map: Map2 = (x, y) => {
      const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy);
      if (r >= R) return [x, y];
      const f = 1 - r / R, a = amt * f * f;
      const c = Math.cos(a), s = Math.sin(a);
      return [cx + dx * c - dy * s, cy + dx * s + dy * c];
    };
    const d = cell / sub;
    const quads = (pick: (i: number, j: number) => boolean) => {
      g.beginPath();
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        if (!pick(i, j)) continue;
        for (let b = 0; b < sub; b++) for (let a = 0; a < sub; a++) {
          const x = x0 + i * cell + a * d, y = y0 + j * cell + b * d;
          const p = [map(x, y), map(x + d, y), map(x + d, y + d), map(x, y + d)];
          p.forEach(([px, py], k) => (k === 0 ? g.moveTo(px, py) : g.lineTo(px, py)));
          g.closePath();
        }
      }
    };
    // a hairline overlap hides the seams between sub-quads
    g.lineWidth = 0.6;
    g.fillStyle = g.strokeStyle = INK;
    quads((i, j) => (i + j) % 2 === 0 && j !== 5);
    g.fill(); g.stroke();
    g.fillStyle = g.strokeStyle = KAKI;
    quads((i, j) => (i + j) % 2 === 0 && j === 5);
    g.fill(); g.stroke();
    g.fillStyle = g.strokeStyle = PALE;
    quads((i, j) => (i + j) % 2 === 1 && j === 5);
    g.fill(); g.stroke();
    // the sheet's edge
    g.strokeStyle = INK;
    g.lineWidth = 2;
    const L = n * cell;
    warpedLoop(g, 240, (u) => {
      const s = u * 4, k = Math.floor(s), f = s - k;
      return k === 0 ? [x0 + f * L, y0] : k === 1 ? [x0 + L, y0 + f * L] : k === 2 ? [x0 + L - f * L, y0 + L] : [x0, y0 + L - f * L];
    }, map);
    g.stroke();
  },

  "wave-warp": (g, t) => {
    // Stripes whose every point is lifted by a sine travelling left to right.
    const x0 = 50, x1 = 350, y0 = 62, n = 8, h = 22, A = 13, lam = 150;
    const dy = (x: number) => A * Math.sin(TAU * (x - x0) / lam - TAU * 2 * t);
    const edge = (y: number, back: boolean) => {
      for (let i = 0; i <= 60; i++) {
        const u = back ? 1 - i / 60 : i / 60, x = lerp(x0, x1, u);
        g.lineTo(x, y + dy(x));
      }
    };
    for (let k = 0; k < n; k++) {
      if (k % 2 === 1) continue;
      const y = y0 + k * h;
      g.fillStyle = k === 4 ? KAKI : INK;
      g.beginPath();
      edge(y, false);
      edge(y + h, true);
      g.closePath();
      g.fill();
    }
    // the sheet's outline
    g.strokeStyle = INK;
    g.lineWidth = 2;
    g.beginPath();
    edge(y0, false);
    edge(y0 + n * h, true);
    g.closePath();
    g.stroke();
  },

  "turbulent-displace": (g, t) => {
    // A ring and a disc whose outlines are pushed by drifting noise. The
    // noise is read on a circle in time, so it comes back at t = 1.
    const cx = W / 2, cy = H / 2;
    const amt = 3 + 22 * smooth(pingPong(t));
    const ox = 1.2 * Math.cos(TAU * t), oy = 1.2 * Math.sin(TAU * t);
    const field = (x: number, y: number, s: number) =>
      noise(x / 40 + ox, y / 40 + oy, s) * 0.8 + noise(x / 18 - oy, y / 18 + ox, s + 7) * 0.2 - 0.5;
    const map: Map2 = (x, y) => [x + 2 * amt * field(x, y, 1), y + 2 * amt * field(x, y, 2)];
    const ring = (r: number) => (u: number): Pt => [cx + r * Math.cos(TAU * u), cy + r * Math.sin(TAU * u)];
    g.lineJoin = "round";
    g.strokeStyle = INK;
    g.lineWidth = 7;
    warpedLoop(g, 200, ring(112), map);
    g.stroke();
    g.fillStyle = KAKI;
    warpedLoop(g, 160, ring(72), map);
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = PAPER;
    warpedLoop(g, 100, ring(36), map);
    g.stroke();
  },

  "displacement-map": (g, t) => {
    // The map is a soft blob on a figure-eight; the grid is pushed away from
    // it, most at its rim and not at all far off.
    const cx = W / 2 + 100 * Math.sin(TAU * t), cy = H / 2 + 45 * Math.sin(2 * TAU * t);
    const sig = 46, A = 30;
    const map: Map2 = (x, y) => {
      const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy) || 1;
      const k = (A * (r / sig) * Math.exp(-(r * r) / (2 * sig * sig)) * 1.65) / r;
      return [x + dx * k, y + dy * k];
    };
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, sig * 2.2);
    grad.addColorStop(0, "rgba(217,102,42,0.55)");
    grad.addColorStop(0.5, "rgba(217,102,42,0.18)");
    grad.addColorStop(1, "rgba(217,102,42,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    g.strokeStyle = INK;
    g.lineWidth = 1.8;
    warpedGrid(g, map, 40, 30, 360, 270, 20, 5);
  },

  "polar-coordinates": (g, t) => {
    // A bar chart bends round a centre until its ends meet: left to right
    // becomes around, top to bottom becomes out to in.
    const f = inHoldOut(t, 0.08, 0.42, 0.58, 0.92);
    const Wd = 280, Hd = lerp(190, 82, f), th = Math.max(1e-3, f * TAU);
    const Rb = Wd / th, mid = Rb + Hd / 2;
    // the arcs start at twelve o'clock and sweep clockwise by th; the centre
    // is placed so their middle stays in the middle of the frame
    const d = (mid * Math.sin(th / 2)) / (th / 2);
    const cx = W / 2 - d * Math.sin(th / 2), cy = H / 2 + d * Math.cos(th / 2);
    // half-wrapped, the arcs are wide: zoom out on the way through
    const z = 1 - 0.45 * Math.sin(Math.PI * f);
    const map: Map2 = (u, v) => {
      // u, v in [0, 1] over the chart; v = 0 is the top bar, the outer ring
      const p = th * u, rho = Rb + (1 - v) * Hd;
      return [W / 2 + z * (cx + rho * Math.sin(p) - W / 2), H / 2 + z * (cy - rho * Math.cos(p) - H / 2)];
    };
    const bars = [0.92, 0.7, 0.82, 0.5, 0.64];
    const bh = 0.13, gap = (1 - bars.length * bh) / (bars.length - 1);
    bars.forEach((len, k) => {
      const v0 = k * (bh + gap), v1 = v0 + bh, m = 48;
      g.beginPath();
      for (let i = 0; i <= m; i++) { const [x, y] = map((len * i) / m, v0); g.lineTo(x, y); }
      for (let i = m; i >= 0; i--) { const [x, y] = map((len * i) / m, v1); g.lineTo(x, y); }
      g.closePath();
      g.fillStyle = k === 2 ? KAKI : INK;
      g.fill();
    });
    // the baseline the bars grow from
    g.strokeStyle = GREY_2;
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i <= 10; i++) { const [x, y] = map(0, -0.04 + (1.08 * i) / 10); g.lineTo(x, y); }
    g.stroke();
  },

  ripple: (g, t) => {
    // Grid points move along the radius by a wave that runs outwards and
    // fades with distance. Two wavelengths pass per loop.
    const cx = W / 2, cy = H / 2, lam = 60, A = 11;
    const phase = (r: number) => TAU * (r / lam) - TAU * 2 * t;
    const env = (r: number) => smooth(clamp(r / 40)) * Math.exp(-r / 190);
    const map: Map2 = (x, y) => {
      const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy) || 1;
      const k = (A * env(r) * Math.sin(phase(r))) / r;
      return [x + dx * k, y + dy * k];
    };
    // faint crests under the grid
    g.save();
    g.beginPath();
    g.rect(30, 30, 340, 240);
    g.clip();
    g.strokeStyle = PALE;
    g.lineWidth = 6;
    for (let r = wrap(2 * t * lam + lam / 4, lam); r < 260; r += lam) {
      g.globalAlpha = clamp(env(r) * 1.4);
      g.beginPath();
      g.arc(cx, cy, r, 0, TAU);
      g.stroke();
    }
    g.restore();
    g.strokeStyle = INK;
    g.lineWidth = 1.8;
    warpedGrid(g, map, 30, 30, 370, 270, 20, 5);
    dot(g, cx, cy, 7, KAKI);
  },

  bend: (g, t) => {
    // A banner laid along an arc whose angle swings from smile to frown.
    const L = 300, T = 70, cx = W / 2, cy = H / 2;
    const th = 1.15 * Math.sin(TAU * t);
    const pos = (s: number, n: number): Pt => {
      // s along the banner in [-L/2, L/2]; n across it, + is down
      if (Math.abs(th) < 1e-4) return [cx + s, cy + n];
      const R = L / th, a = s / R;
      return [cx + Math.sin(a) * (R - n), cy + R - Math.cos(a) * (R - n)];
    };
    const ang = (s: number) => (Math.abs(th) < 1e-4 ? 0 : (s * th) / L);
    const m = 60;
    g.beginPath();
    for (let i = 0; i <= m; i++) { const [x, y] = pos(-L / 2 + (L * i) / m, -T / 2); g.lineTo(x, y); }
    for (let i = m; i >= 0; i--) { const [x, y] = pos(-L / 2 + (L * i) / m, T / 2); g.lineTo(x, y); }
    g.closePath();
    g.fillStyle = KAKI;
    g.fill();
    // letters ride the arc
    const word = "BEND";
    font(g, 44, 800);
    g.fillStyle = PAPER;
    g.textAlign = "center";
    g.textBaseline = "middle";
    [...word].forEach((ch, i) => {
      const s = (i - (word.length - 1) / 2) * 44;
      const [x, y] = pos(s, 2);
      g.save();
      g.translate(x, y);
      g.rotate(ang(s));
      g.fillText(ch, 0, 0);
      g.restore();
    });
  },

  kaleidoscope: (g, t) => {
    // One wedge of moving shapes (outlined) fans out into 8 mirrored copies,
    // then folds back into one before the loop ends.
    const N = 8, seg = TAU / N, R = 125, cx = W / 2, cy = H / 2;
    const content = () => {
      const a1 = seg * (0.45 + 0.6 * Math.sin(TAU * t)), r1 = 76 + 20 * Math.sin(TAU * t + 1);
      dot(g, r1 * Math.cos(a1), r1 * Math.sin(a1), 22, KAKI);
      const r2 = t * 150 - 12;
      dot(g, r2 * Math.cos(seg * 0.2), r2 * Math.sin(seg * 0.2), 9, INK);
      g.save();
      g.rotate(seg * (0.15 + 0.3 * Math.sin(TAU * t + 2)));
      g.fillStyle = INK;
      g.fillRect(24, -6, 74, 12);
      g.restore();
    };
    const p = out(span(t, 0.1, 0.38)) * (1 - inOut(span(t, 0.8, 0.96)));
    g.translate(cx, cy);
    g.rotate(-Math.PI / 2 - seg / 2 + 0.25 * Math.sin(TAU * t));
    // last copy first, so while folded the source wedge sits on top
    for (let k = N - 1; k >= 0; k--) {
      g.save();
      if (k % 2 === 0) g.rotate(k * seg * p);
      else { g.rotate(seg + k * seg * p); g.scale(1, -1); }
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, R, -0.004, seg + 0.004);
      g.closePath();
      g.fillStyle = PAPER;
      g.fill();
      g.clip();
      content();
      g.restore();
    }
    g.strokeStyle = INK;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(0, 0, R, 0, TAU);
    g.stroke();
    // the source wedge
    g.strokeStyle = KAKI;
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, R, 0, seg);
    g.closePath();
    g.stroke();
  },

  "slit-scan": (g, t) => {
    // Each row of the frame shows the scene a little later than the row
    // above, so the swinging disc leans and smears.
    const top = 50, bot = 250, r = 70, cy = H / 2, lag = 0.3, row = 2.5;
    const xAt = (tau: number) => W / 2 + 115 * Math.sin(TAU * tau);
    g.fillStyle = KAKI;
    g.beginPath();
    for (let y = top; y < bot; y += row) {
      const ym = y + row / 2 - cy;
      if (Math.abs(ym) >= r) continue;
      const hw = Math.sqrt(r * r - ym * ym), x = xAt(t - (lag * (y - top)) / (bot - top));
      g.rect(x - hw, y, hw * 2, row + 0.4);
    }
    g.fill();
    // the disc as it really is now
    g.strokeStyle = INK;
    g.lineWidth = 2;
    g.setLineDash([5, 5]);
    g.beginPath();
    g.arc(xAt(t), cy, r, 0, TAU);
    g.stroke();
    g.setLineDash([]);
    // the slit: a marker on the left edge
    g.fillStyle = INK_2;
    for (let y = top; y <= bot; y += 25) g.fillRect(14, y - 1, y === top || y === bot ? 16 : 8, 2);
  },

  "motion-tile": (g, t) => {
    // One tile (the layer, outlined) repeated past its edges. Scrolling it
    // diagonally by one tile a loop shows no seam.
    const S = 90, ox = S * t, oy = S * t;
    const bx = W / 2 - S / 2, by = H / 2 - S / 2;
    const tile = (x: number, y: number) => {
      dot(g, x + 28, y + 28, 15, KAKI);
      g.fillStyle = INK;
      g.save();
      g.translate(x + 64, y + 62);
      g.rotate(Math.PI / 4);
      g.fillRect(-11, -11, 22, 22);
      g.restore();
      dot(g, x + 72, y + 22, 4, INK);
      dot(g, x + 22, y + 72, 4, INK);
    };
    const all = () => {
      for (let j = -2; j <= 2; j++) for (let i = -3; i <= 3; i++) tile(bx + i * S + ox - S, by + j * S + oy - S);
    };
    g.globalAlpha = 0.28;
    all();
    g.globalAlpha = 1;
    g.save();
    g.beginPath();
    g.rect(bx, by, S, S);
    g.clip();
    all();
    g.restore();
    g.strokeStyle = INK;
    g.lineWidth = 2.5;
    g.strokeRect(bx, by, S, S);
  },

  "radial-blur": (g, t) => {
    // Two shots, cut at t = 0.25 and 0.75. The blur ramps up into each cut
    // and dies away after it. The blur is the shot drawn many times, each a
    // little larger about the centre, averaged: copy i is drawn at alpha
    // 1 / (i + 1) over the ones before, so all copies weigh the same.
    const cuts = [0.25, 0.75];
    let amt = 0;
    for (const c of cuts) {
      const d = wrap(t - c + 0.5, 1) - 0.5; // signed distance to the cut
      amt = Math.max(amt, d < 0 ? inCubic(clamp(1 + d / 0.16)) : 1 - out(clamp(d / 0.13)));
    }
    const shotB = t >= 0.25 && t < 0.75;
    const cx = W / 2, cy = H / 2;
    const shot = (c: CanvasRenderingContext2D) => {
      c.fillStyle = shotB ? KAKI : PAPER;
      c.fillRect(-W, -H, 3 * W, 3 * H);
      const fg = shotB ? PAPER : INK;
      // a ring of marks: at the edge the smear is longest
      for (let i = 0; i < 16; i++) {
        const a = (i * TAU) / 16 + (shotB ? TAU / 32 : 0);
        const r = i % 2 ? 128 : 112;
        const x = cx + r * 1.25 * Math.cos(a), y = cy + r * Math.sin(a);
        if (shotB) dot(c, x, y, i % 2 ? 6 : 9, i % 4 === 0 ? INK : fg);
        else { c.fillStyle = i % 4 === 0 ? KAKI : fg; c.fillRect(x - 7, y - 7, 14, 14); }
      }
      c.textAlign = "center";
      c.textBaseline = "middle";
      font(c, shotB ? 92 : 66, 800);
      c.fillStyle = fg;
      c.fillText(shotB ? "GO!" : "READY", cx, cy + 4);
    };
    // draw the shot once, sharp, at the canvas's device resolution
    const m = g.getTransform(), k = Math.hypot(m.a, m.b);
    const sw = Math.ceil(W * k), sh = Math.ceil(H * k);
    const buf = scratch(sw, sh);
    const b = buf.getContext("2d")!;
    b.setTransform(sw / W, 0, 0, sh / H, 0, 0);
    shot(b);
    const N = amt < 0.01 ? 1 : 16, spread = 0.42 * amt;
    for (let i = 0; i < N; i++) {
      const s = 1 + (spread * i) / Math.max(1, N - 1);
      g.globalAlpha = 1 / (i + 1);
      g.drawImage(buf, 0, 0, sw, sh, cx - (W * s) / 2, cy - (H * s) / 2, W * s, H * s);
    }
    g.globalAlpha = 1;
  },
};
