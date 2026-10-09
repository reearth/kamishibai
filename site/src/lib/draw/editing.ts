// Editing: how each term's loop is drawn. See kit.ts.
import { W, H, TAU, INK, INK_2, PAPER, KAKI, KAKI_2, PALE, GREY, GREY_2, MIST, lerp, span, inOut, out, smooth, wrap, rand, noise, fill, dot, font, type Paint, type Shapes } from "./kit.ts";

export const SHAPES: Record<string, Shapes> = {};

// ---- local helpers ----
type G = CanvasRenderingContext2D;

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

function box(g: G, x: number, y: number, w: number, h: number, color: string): void {
  g.fillStyle = color;
  g.fillRect(x, y, w, h);
}

function mono(g: G, px: number, weight = 500): void {
  g.font = `${weight} ${px}px "Geist Mono", ui-monospace, monospace`;
}

/** Limb angles in radians from straight down; positive swings toward +x. */
interface Pose {
  lean?: number;
  armA: number; elbowA?: number;
  armB: number; elbowB?: number;
  legA: number; kneeA?: number;
  legB: number; kneeB?: number;
}

/** A simple person standing on (x, y): orange shirt, ink limbs and head. */
function figure(g: G, x: number, y: number, s: number, p: Pose, outline = 0): void {
  const hip: [number, number] = [x, y - 46 * s];
  const lean = p.lean ?? 0;
  const sh: [number, number] = [hip[0] + Math.sin(lean) * 32 * s, hip[1] - Math.cos(lean) * 32 * s];
  const head: [number, number] = [sh[0] + Math.sin(lean) * 19 * s, sh[1] - Math.cos(lean) * 19 * s];
  const limb = (from: [number, number], a: number, bend: number, len: number, w: number, col: string) => {
    const k: [number, number] = [from[0] + Math.sin(a) * len * s, from[1] + Math.cos(a) * len * s];
    const e: [number, number] = [k[0] + Math.sin(a + bend) * len * s, k[1] + Math.cos(a + bend) * len * s];
    g.strokeStyle = col;
    g.lineWidth = w * s;
    g.beginPath();
    g.moveTo(from[0], from[1]);
    g.lineTo(k[0], k[1]);
    g.lineTo(e[0], e[1]);
    g.stroke();
  };
  g.lineCap = "round";
  g.lineJoin = "round";
  const draw = (pad: number, back: string, front: string, body: string, headCol: string) => {
    limb(sh, p.armB, p.elbowB ?? 0, 17, 8 + pad, back);
    limb(hip, p.legB, p.kneeB ?? 0, 24, 9 + pad, back);
    g.strokeStyle = body;
    g.lineWidth = (17 + pad) * s;
    g.beginPath();
    g.moveTo(hip[0], hip[1]);
    g.lineTo(sh[0], sh[1]);
    g.stroke();
    limb(hip, p.legA, p.kneeA ?? 0, 24, 9 + pad, front);
    dot(g, head[0], head[1], (12 + pad / 2) * s, headCol);
    limb(sh, p.armA, p.elbowA ?? 0, 17, 8 + pad, front);
  };
  if (outline > 0) draw(outline * 2, PAPER, PAPER, PAPER, PAPER);
  draw(0, INK_2, INK, KAKI, INK);
}

/** Head and shoulders, for talking shots. */
function bust(g: G, x: number, y: number, s: number, col: string, talk: number): void {
  rrect(g, x - 46 * s, y + 20 * s, 92 * s, 80 * s, 40 * s, col);
  dot(g, x, y - 8 * s, 27 * s, col);
  dot(g, x - 9 * s, y - 12 * s, 3 * s, PAPER);
  dot(g, x + 9 * s, y - 12 * s, 3 * s, PAPER);
  g.fillStyle = PAPER;
  g.beginPath();
  g.ellipse(x, y + 4 * s, 6 * s, (1.2 + 4 * talk) * s, 0, 0, TAU);
  g.fill();
}

/** Sound arcs fanning out from (x, y) toward dir (1 right, -1 left). */
function waves(g: G, x: number, y: number, dir: number, s: number, col: string, t: number): void {
  g.strokeStyle = col;
  g.lineCap = "round";
  g.lineWidth = 3.5 * s;
  for (let k = 0; k < 3; k++) {
    const ph = wrap(t * 6 - k / 3, 1);
    g.globalAlpha = 0.25 + 0.75 * (1 - ph);
    const r = (10 + k * 9) * s;
    g.beginPath();
    g.arc(x, y, r, dir > 0 ? -0.7 : Math.PI - 0.7, dir > 0 ? 0.7 : Math.PI + 0.7);
    g.stroke();
  }
  g.globalAlpha = 1;
}

/**
 * The J and L cuts: a picture over a two-track timeline (video above audio)
 * that scrolls under a fixed playhead. Clips alternate between two speakers;
 * the audio cut sits `lead` units before (J) or after (L) the picture cut.
 */
function splitEdit(g: G, t: number, lead: number): void {
  const LC = 180, P = 2 * LC, PH = 214;
  const pos = t * P;
  // the picture
  const px = 106, py = 12, pw = 216, ph = 162;
  const vk = wrap(Math.floor(pos / LC), 2);
  const ak = wrap(Math.floor((pos + lead) / LC), 2);
  const talk = 0.5 + 0.5 * Math.sin(TAU * t * 12);
  g.save();
  g.beginPath();
  g.rect(px, py, pw, ph);
  g.clip();
  box(g, px, py, pw, ph, vk === 0 ? MIST : PALE);
  const col = vk === 0 ? INK_2 : KAKI;
  bust(g, px + pw / 2, py + 82, 1, col, ak === vk ? talk : 0);
  if (ak === vk) waves(g, px + pw / 2 + 40, py + 82, 1, 0.9, col, t);
  // the other speaker's voice, from off screen: the next one (J) enters from
  // the right, the last one (L) trails off on the left
  else if (lead > 0) waves(g, px + pw - 4, py + 72, -1, 1.25, ak === 0 ? INK_2 : KAKI, t);
  else waves(g, px + 4, py + 72, 1, 1.25, ak === 0 ? INK_2 : KAKI, t);
  g.restore();
  g.strokeStyle = INK;
  g.lineWidth = 1.5;
  g.strokeRect(px, py, pw, ph);
  // the tracks
  const X0 = 44, X1 = 388, VY = 192, AY = 238, TH = 34;
  font(g, 13, 700);
  g.fillStyle = INK_2;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("V", 24, VY + TH / 2);
  g.fillText("A", 24, AY + TH / 2);
  g.save();
  g.beginPath();
  g.rect(X0, VY - 4, X1 - X0, AY + TH - VY + 8);
  g.clip();
  box(g, X0, VY, X1 - X0, TH, MIST);
  box(g, X0, AY, X1 - X0, TH, MIST);
  for (let k = -2; k <= 3; k++) {
    const u0 = Math.floor(pos / LC) * LC + k * LC;
    const who = wrap(Math.round(u0 / LC), 2);
    const x = PH + (u0 - pos);
    rrect(g, x + 1, VY, LC - 2, TH, 3, who === 0 ? INK_2 : KAKI);
    // a thumbnail head at the clip's start
    dot(g, x + 16, VY + 13, 6, who === 0 ? GREY : PALE);
    rrect(g, x + 7, VY + 20, 18, 14, 6, who === 0 ? GREY : PALE);
    const ax = x - lead;
    rrect(g, ax + 1, AY, LC - 2, TH, 3, who === 0 ? GREY : PALE);
    g.fillStyle = who === 0 ? INK_2 : KAKI;
    for (let i = 0; i < LC / 5 - 1; i++) {
      const gi = wrap(Math.round(u0 / 5) + i, P / 5);
      const h = 4 + (TH - 12) * (0.25 + 0.75 * rand(gi, 7)) * (0.5 + 0.5 * Math.sin(gi * 0.7));
      g.fillRect(ax + 5 + i * 5, AY + TH / 2 - h / 2, 2.6, h);
    }
  }
  g.restore();
  // the playhead
  g.strokeStyle = INK;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(PH, VY - 6);
  g.lineTo(PH, AY + TH + 6);
  g.stroke();
  poly(g, [PH - 7, VY - 12, PH + 7, VY - 12, PH, VY - 3], INK);
}

// Calm, then loud: the two shots of the smash cut.
function sleeper(g: G, t: number): void {
  fill(g, MIST);
  // window and moon
  rrect(g, 262, 36, 96, 80, 3, INK_2);
  dot(g, 318, 70, 18, PALE);
  dot(g, 328, 64, 16, INK_2);
  // bed
  rrect(g, 40, 176, 300, 26, 6, GREY_2);
  box(g, 40, 202, 12, 34, GREY_2);
  box(g, 328, 202, 12, 34, GREY_2);
  rrect(g, 56, 150, 70, 28, 12, PAPER);
  dot(g, 98, 146, 20, INK_2);
  const br = Math.sin(TAU * t * 2) * 3;
  g.fillStyle = GREY;
  g.beginPath();
  g.moveTo(108, 178);
  g.bezierCurveTo(140, 140 - br, 290, 140 - br, 330, 178);
  g.closePath();
  g.fill();
  // the z's float up
  font(g, 22, 700);
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (let k = 0; k < 3; k++) {
    const ph = wrap(t * 3 + k / 3, 1);
    g.globalAlpha = Math.sin(ph * Math.PI);
    g.fillStyle = GREY_2;
    g.fillText("z", 126 + ph * 40 + k * 4, 118 - ph * 70);
  }
  g.globalAlpha = 1;
}

function alarm(g: G, t: number, since: number): void {
  fill(g, KAKI);
  const q = Math.floor(t * 26 * 2);
  const jx = (rand(q, 1) - 0.5) * 14, jy = (rand(q, 2) - 0.5) * 10, rot = (rand(q, 3) - 0.5) * 0.28;
  const punch = 1 + 0.25 * (1 - out(span(since, 0, 0.08)));
  g.save();
  g.translate(200 + jx, 162 + jy);
  g.scale(punch, punch);
  g.rotate(rot);
  // ringing marks
  g.strokeStyle = PAPER;
  g.lineCap = "round";
  g.lineWidth = 7;
  for (const side of [-1, 1]) {
    for (const a of [-0.5, 0, 0.5]) {
      const ang = -Math.PI / 2 + side * (0.75 + a * 0.55);
      g.beginPath();
      g.moveTo(Math.cos(ang) * 104, Math.sin(ang) * 104);
      g.lineTo(Math.cos(ang) * 132, Math.sin(ang) * 132);
      g.stroke();
    }
  }
  // bells, legs, body, face
  for (const side of [-1, 1]) {
    g.save();
    g.rotate(side * 0.65);
    g.fillStyle = INK;
    g.beginPath();
    g.arc(0, -86, 26, Math.PI, 0);
    g.fill();
    g.restore();
    g.strokeStyle = INK;
    g.lineWidth = 10;
    g.beginPath();
    g.moveTo(side * 40, 60);
    g.lineTo(side * 58, 90);
    g.stroke();
  }
  dot(g, 0, 0, 76, INK);
  dot(g, 0, 0, 60, PAPER);
  g.strokeStyle = INK;
  g.lineWidth = 7;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(0, -40);
  g.moveTo(0, 0);
  g.lineTo(28, 10);
  g.stroke();
  dot(g, 0, 0, 7, KAKI);
  g.restore();
}

// The shots of cut to the beat, each a bold graphic that keeps drifting.
function beatShot(g: G, k: number, f: number, h: number): void {
  const cx = 200, cy = h / 2;
  if (k === 0) {
    box(g, 0, 0, W, h, PAPER);
    dot(g, cx + f * 20, cy, 70, KAKI);
  } else if (k === 1) {
    box(g, 0, 0, W, h, INK);
    g.strokeStyle = PAPER;
    g.lineWidth = 16;
    for (let i = -6; i < 10; i++) {
      const x = i * 46 + f * 30;
      g.beginPath();
      g.moveTo(x, h + 10);
      g.lineTo(x + h + 20, -10);
      g.stroke();
    }
  } else if (k === 2) {
    box(g, 0, 0, W, h, KAKI);
    g.save();
    g.translate(cx, cy + 12);
    g.rotate(f * 0.25);
    poly(g, [0, -86, 84, 58, -84, 58], INK);
    g.restore();
  } else {
    box(g, 0, 0, W, h, MIST);
    for (let r = 5; r >= 1; r--) dot(g, cx, cy, r * 22 * (1 + f * 0.12), r % 2 ? INK : MIST);
  }
}


// The badges of the flash cut, 1st to 9th, each on its own ground.
const FLASH_GROUNDS = [INK, KAKI, PAPER, INK_2, PALE, MIST, KAKI_2, INK, KAKI] as const;
const FLASH_BADGES = [KAKI, PAPER, INK, KAKI, INK, KAKI, INK, PALE, PAPER] as const;

function ordinal(n: number): string {
  return n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th";
}

/** A rosette badge: a scalloped disc with a ring and the place in the middle. */
function badge(g: G, k: number, punch: number): void {
  const bg = FLASH_GROUNDS[k] ?? INK, col = FLASH_BADGES[k] ?? KAKI;
  box(g, 0, 0, W, H, bg);
  // a few speed lines behind, a different angle each shot
  g.save();
  g.translate(200, 150);
  g.rotate(rand(k, 4) * Math.PI);
  g.strokeStyle = col;
  g.globalAlpha = 0.18;
  g.lineWidth = 10;
  for (let i = -5; i <= 5; i++) {
    g.beginPath();
    g.moveTo(-320, i * 34);
    g.lineTo(320, i * 34);
    g.stroke();
  }
  g.restore();
  const x = 200 + (rand(k, 1) - 0.5) * 70, y = 146 + (rand(k, 2) - 0.5) * 30;
  const r = 92 * punch;
  g.save();
  g.translate(x, y);
  g.rotate((rand(k, 3) - 0.5) * 0.5);
  // the ribbons
  const dark = bg === INK || bg === INK_2;
  const ribbon = dark ? (col === KAKI ? PALE : KAKI) : col === KAKI || bg === KAKI || bg === KAKI_2 ? INK : KAKI;
  for (const side of [-1, 1]) poly(g, [side * 18, 40, side * 62, 40 + r * 0.9, side * 46, 44 + r * 0.75, side * 30, 52 + r * 0.95, side * 2, 60], ribbon);
  // the scalloped edge
  g.fillStyle = col;
  g.beginPath();
  const n = 20;
  for (let i = 0; i <= n * 2; i++) {
    const a = (i / (n * 2)) * TAU, rr = i % 2 ? r : r * 0.9;
    g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  g.closePath();
  g.fill();
  g.strokeStyle = bg;
  g.lineWidth = 4;
  g.beginPath();
  g.arc(0, 0, r * 0.74, 0, TAU);
  g.stroke();
  // the place
  const num = String(k + 1), suf = ordinal(k + 1);
  g.fillStyle = bg;
  g.textBaseline = "alphabetic";
  font(g, 74 * punch, 800);
  const nw = g.measureText(num).width;
  font(g, 26 * punch, 800);
  const sw = g.measureText(suf).width;
  const x0 = -(nw + sw + 2) / 2;
  font(g, 74 * punch, 800);
  g.textAlign = "left";
  g.fillText(num, x0, 26 * punch);
  font(g, 26 * punch, 800);
  g.fillText(suf, x0 + nw + 2, -6 * punch);
  g.restore();
}

export const PAINT: Record<string, Paint> = {
  // A ball tossed up to the middle of the frame cuts to a sun in the same
  // place, the same size; the sun sets, and it cuts back.
  "match-cut": (g, t) => {
    const CUT = 0.5, X = 200, Y = 116, R = 30;
    if (t < CUT) {
      // shot 1: a park, the ball flying up
      box(g, 0, 0, W, H, PAPER);
      box(g, 0, 232, W, 68, MIST);
      for (let k = 0; k < 9; k++) box(g, 16 + k * 46, 196, 6, 40, GREY);
      box(g, 0, 206, W, 5, GREY);
      dot(g, 330, 150, 34, GREY_2);
      box(g, 327, 170, 6, 64, INK_2);
      const ball = (u: number) => [lerp(70, X, u), Y + 250 * (1 - u) * (1 - u)] as const;
      const u = span(t, 0.02, CUT);
      for (let k = 1; k <= 5; k++) {
        const [bx, by] = ball(Math.max(0, u - k * 0.05));
        g.globalAlpha = 0.18 * (1 - k / 6);
        dot(g, bx, by, R, KAKI);
      }
      g.globalAlpha = 1;
      const [bx, by] = ball(u);
      dot(g, bx, by, R, KAKI);
    } else {
      // shot 2: the sun sets over the sea
      const sink = span(t, CUT, 1) * 18;
      box(g, 0, 0, W, H, PAPER);
      box(g, 0, 120, W, 80, "#FCEFE5");
      box(g, 0, 160, W, 40, "#F8DDCA");
      dot(g, X, Y + sink, R, KAKI);
      box(g, 0, 196, W, 104, INK_2);
      g.fillStyle = KAKI_2;
      for (let k = 0; k < 6; k++) {
        const w = 70 - k * 10 + 8 * Math.sin(TAU * (t * 2 + k * 0.3));
        g.fillRect(X - w / 2, 206 + k * 14, w, 4);
      }
    }
  },

  // One shot with the dull parts cut out: the person pops from place to
  // place and the clock on the wall skips ahead at every cut.
  "jump-cut": (g, t) => {
    const seg = Math.floor(t * 4), f = t * 4 - seg;
    box(g, 0, 0, W, H, PAPER);
    box(g, 0, 236, W, 64, MIST);
    // window, plant
    rrect(g, 40, 50, 92, 104, 3, MIST);
    box(g, 84, 50, 4, 104, PAPER);
    box(g, 40, 100, 92, 4, PAPER);
    rrect(g, 346, 204, 30, 34, 4, GREY_2);
    for (const [a, l] of [[-0.5, 40], [0, 50], [0.5, 38]] as const) {
      g.save();
      g.translate(361, 206);
      g.rotate(a);
      g.fillStyle = GREY;
      g.beginPath();
      g.ellipse(0, -l / 2, 8, l / 2, 0, 0, TAU);
      g.fill();
      g.restore();
    }
    // the clock: running within a shot, skipping ahead at each cut
    const cx = 300, cy = 70;
    dot(g, cx, cy, 26, INK);
    dot(g, cx, cy, 21, PAPER);
    const min = seg * 15 + f * 3;
    const a = -Math.PI / 2 + (min / 60) * TAU;
    g.strokeStyle = INK;
    g.lineCap = "round";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx, cy - 11);
    g.stroke();
    g.strokeStyle = KAKI;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a) * 17, cy + Math.sin(a) * 17);
    g.stroke();
    dot(g, cx, cy, 2.5, INK);
    // the person, somewhere new each time
    const sway = Math.sin(TAU * t * 4) * 0.03;
    const poses: [number, Pose][] = [
      [112, { lean: sway, armA: 0.15, armB: -0.15, legA: 0.08, legB: -0.08 }],
      [246, { lean: sway, armA: 2.0, elbowA: 1.0, armB: -0.2, legA: 0.12, legB: -0.12 }],
      [176, { lean: sway, armA: 0.9, elbowA: -1.9, armB: -0.9, elbowB: 1.9, legA: 0.28, legB: -0.28 }],
      [296, { lean: sway, armA: 2.1, elbowA: 0.6, armB: -2.1, elbowB: -0.6, legA: 0.18, legB: -0.18 }],
    ];
    const [x, p] = poses[seg] ?? poses[0]!;
    figure(g, x, 252, 1.3, p);
  },

  "j-cut": (g, t) => splitEdit(g, t, 56),

  "l-cut": (g, t) => splitEdit(g, t, -56),

  // A sleeper in a quiet grey room; hard cut to a ringing alarm clock on orange.
  "smash-cut": (g, t) => {
    const CUT = 0.55;
    if (t < CUT) sleeper(g, t);
    else alarm(g, t, t - CUT);
  },

  // A divider slides in: the caller's shot moves to the left half and the
  // other end of the call fills the right.
  "split-screen": (g, t) => {
    const k = inOut(span(t, 0.14, 0.32)) - inOut(span(t, 0.8, 0.96));
    const D = W - 200 * k;
    const talk = (on: boolean) => (on ? 0.5 + 0.5 * Math.sin(TAU * t * 12) : 0);
    const aTalks = t < 0.5 || t > 0.9;
    // shot A, centred in what is left of the frame
    g.save();
    g.beginPath();
    g.rect(0, 0, D, H);
    g.clip();
    g.translate(-(W - D) / 2, 0);
    box(g, 0, 0, W, H, MIST);
    box(g, 84, 40, 66, 86, PAPER);
    box(g, 115, 40, 4, 86, MIST);
    bust(g, 200, 170, 1.5, INK_2, talk(aTalks));
    rrect(g, 236, 136, 16, 38, 5, INK);
    if (aTalks) waves(g, 252, 150, 1, 1, INK_2, t);
    g.restore();
    // shot B
    if (D < W) {
      g.save();
      g.beginPath();
      g.rect(D, 0, W - D, H);
      g.clip();
      g.translate(D + (W - D) / 2 - 200, 0);
      box(g, 0, 0, W, H, PALE);
      dot(g, 262, 66, 26, KAKI_2);
    box(g, 258, 92, 8, 60, KAKI_2);
      bust(g, 200, 170, 1.5, KAKI, talk(!aTalks));
      rrect(g, 148, 136, 16, 38, 5, INK);
      if (!aTalks) waves(g, 148, 150, -1, 1, INK, t);
      g.restore();
      // the divider
      box(g, D - 3, 0, 6, H, PAPER);
    }
  },

  // A new shot lands on every beat; the counter below lights the beat.
  "cut-to-the-beat": (g, t) => {
    const b = Math.floor(t * 4), f = t * 4 - b;
    const SH = 226;
    const hit = 1 - out(span(f, 0, 0.35));
    g.save();
    g.beginPath();
    g.rect(0, 0, W, SH);
    g.clip();
    g.translate(200, SH / 2);
    const z = 1 + 0.07 * hit;
    g.scale(z, z);
    g.translate(-200, -SH / 2);
    beatShot(g, b, f, SH);
    g.restore();
    box(g, 0, SH, W, H - SH, PAPER);
    box(g, 0, SH, W, 1.5, INK);
    // the beats
    for (let i = 0; i < 4; i++) {
      const x = 200 + (i - 1.5) * 64, y = SH + (H - SH) / 2;
      if (i === b) {
        const s = 22 * (1 + 0.35 * hit);
        rrect(g, x - s / 2, y - s / 2, s, s, 4, KAKI);
      } else {
        g.strokeStyle = GREY_2;
        g.lineWidth = 2;
        g.beginPath();
        g.roundRect(x - 11, y - 11, 22, 22, 4);
        g.stroke();
      }
    }
  },

  // A ball jumps: fast on the way up, nearly still at the top, fast again.
  // The ghosts behind it bunch up in the slow part; the graph shows the speed.
  "speed-ramp": (g, t) => {
    const A = 0.88;
    const tau = (x: number) => x + (A * Math.sin(TAU * x)) / TAU;
    const speed = 1 + A * Math.cos(TAU * t);
    const GY = 232, R = 20, RUN = 240, JH = 140;
    const u = tau(t);
    box(g, 0, 0, W, H, PAPER);
    // far posts and lane marks scroll with the jump
    for (let k = 0; k < 9; k++) {
      const x = wrap(k * 50 - u * 100, 450) - 25;
      box(g, x, GY - 40, 4, 40, GREY);
    }
    box(g, 0, GY, W, H - GY, MIST);
    for (let k = 0; k < 6; k++) {
      const x = wrap(k * 80 - u * RUN, 480) - 40;
      box(g, x, GY + 30, 40, 5, GREY);
    }
    const ballAt = (v: number, alpha: number, x: number) => {
      const c = Math.max(0, 1 - Math.min(v, 1 - v) / 0.05);
      const sx = 1 + 0.3 * c, sy = 1 - 0.3 * c;
      const y = GY - R * sy - JH * 4 * v * (1 - v);
      g.globalAlpha = alpha;
      g.save();
      g.translate(x, y);
      g.scale(sx, sy);
      dot(g, 0, 0, R, KAKI);
      if (alpha === 1) {
        g.rotate(v * TAU);
        g.strokeStyle = INK;
        g.lineWidth = 4;
        g.beginPath();
        g.moveTo(-R + 2, 0);
        g.lineTo(R - 2, 0);
        g.stroke();
      }
      g.restore();
      g.globalAlpha = 1;
    };
    const bx = 180;
    for (let k = 6; k >= 1; k--) {
      const v = tau(t - k * 0.016);
      ballAt(wrap(v, 1), 0.3 * (1 - k / 7), bx - (u - v) * RUN);
    }
    ballAt(u >= 1 ? 0 : u, 1, bx);
    // the speed graph
    const gx = 280, gy = 22, gw = 100, gh = 46;
    g.strokeStyle = GREY_2;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(gx, gy + gh);
    g.lineTo(gx + gw, gy + gh);
    g.stroke();
    g.strokeStyle = INK;
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i <= 40; i++) {
      const x = i / 40;
      g.lineTo(gx + x * gw, gy + gh - ((1 + A * Math.cos(TAU * x)) / 2) * gh);
    }
    g.stroke();
    dot(g, gx + t * gw, gy + gh - (speed / 2) * gh, 5, KAKI);
    mono(g, 20);
    g.fillStyle = INK;
    g.textAlign = "left";
    g.textBaseline = "alphabetic";
    g.fillText(`${(speed * 1.0).toFixed(1)}×`, 22, 42);
  },

  // A runner leaps the hurdle; the frame freezes at the top with a flash,
  // a name card slides in, then the action runs on.
  "freeze-frame": (g, t) => {
    const F = 0.28, R = 0.74;
    const a = t < F ? (t / F) * 0.5 : t < R ? 0.5 : 0.5 + ((t - R) / (1 - R)) * 0.5;
    const frozen = t >= F && t < R;
    const GY = 236;
    // the held frame pushes in a little on the runner
    const push = frozen ? 1 + 0.1 * out(span(t, F, R)) : 1;
    g.save();
    g.translate(200, 110);
    g.scale(push, push);
    g.translate(-200, -110);
    box(g, 0, 0, W, H, PAPER);
    box(g, 0, GY, W, H - GY, MIST);
    box(g, 60, GY - 70, 280, 6, GREY);
    // the hurdle
    box(g, 192, GY - 52, 6, 52, GREY_2);
    box(g, 172, GY - 56, 46, 8, INK_2);
    const x = lerp(-60, 460, a);
    const j = span(a, 0.32, 0.68);
    const lift = Math.sin(j * Math.PI) * 96;
    const ph = TAU * a * 6;
    const run: Pose = {
      lean: 0.2,
      armA: Math.sin(ph) * 1.1, elbowA: -1.2,
      armB: -Math.sin(ph) * 1.1, elbowB: -1.2,
      legA: -Math.sin(ph) * 0.8, kneeA: -0.6 - 0.5 * Math.max(0, Math.sin(ph)),
      legB: Math.sin(ph) * 0.8, kneeB: -0.6 - 0.5 * Math.max(0, -Math.sin(ph)),
    };
    const leap: Pose = { lean: 0.35, armA: 2.4, elbowA: 0.3, armB: -1.4, elbowB: -0.4, legA: 1.5, kneeA: -0.1, legB: -0.6, kneeB: -1.4 };
    const jumping = j > 0 && j < 1;
    if (frozen) {
      g.globalAlpha = 0.45;
      box(g, 0, 0, W, H, PAPER);
      g.globalAlpha = 1;
    }
    figure(g, x, GY - lift, 1, jumping ? leap : run, frozen ? 3 : 0);
    g.restore();
    if (frozen) {
      const fl = 1 - span(t, F, F + 0.08);
      if (fl > 0) {
        g.globalAlpha = fl;
        box(g, 0, 0, W, H, PAPER);
        g.globalAlpha = 1;
      }
      // the name card
      const k = out(span(t, F + 0.04, F + 0.14)) - inOut(span(t, R - 0.08, R - 0.01));
      const cx = lerp(-230, 20, k);
      rrect(g, cx, 228, 200, 46, 3, INK);
      rrect(g, cx, 210, 112, 22, 3, KAKI);
      font(g, 12, 700);
      g.fillStyle = PAPER;
      g.textAlign = "left";
      g.textBaseline = "middle";
      g.fillText("THE RUNNER", cx + 10, 221.5);
      font(g, 26, 800);
      g.fillText("Taro", cx + 14, 252);
    }
  },

  // Nine badges, 1st to 9th, a fifth of a second each; the last one holds.
  // The ticks below count the shots off.
  "flash-cut": (g, t) => {
    const D = 0.2 / 2.6;
    const k = Math.min(8, Math.floor(t / D));
    const since = t - k * D;
    const punch = 1 + 0.12 * (1 - out(span(since, 0, k < 8 ? D : 0.12)));
    // the last badge holds, pushing in slowly
    const hold = k < 8 ? 1 : 1 + 0.06 * smooth(span(since, 0.1, 1 - 8 * D));
    badge(g, k, punch * hold);
    for (let i = 0; i < 9; i++) {
      const x = 200 + (i - 4) * 18, y = 278;
      const on = i <= k;
      const bg = FLASH_GROUNDS[k] ?? INK;
      const light = bg === INK || bg === INK_2 || bg === KAKI;
      g.globalAlpha = on ? 1 : 0.35;
      rrect(g, x - 5, y - 5, 10, 10, 2, light ? PAPER : INK);
      g.globalAlpha = 1;
    }
  },
};
