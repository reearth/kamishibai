// The drawables of one moment, painted on the host's 2D context.
// ------------------------------------------------------------------
import type { Context2D, Env } from "../canvas/types.ts";
import type { Cam, Layer, Live } from "./engine.ts";
import { bbox } from "./model.ts";
import type { Fonts } from "./text.ts";

const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

/** The first `prog` of a polyline's length. */
function partial(pts: [number, number][], prog: number): [number, number][] {
  if (prog >= 1) return pts;
  const seg = pts.slice(1).map((q, i) => Math.hypot(q[0] - pts[i]![0], q[1] - pts[i]![1]));
  let left = seg.reduce((a, b) => a + b, 0) * prog;
  const out: [number, number][] = [pts[0]!];
  for (let i = 0; i < seg.length; i++) {
    const [a, b] = [pts[i]!, pts[i + 1]!];
    if (left >= seg[i]!) {
      out.push(b);
      left -= seg[i]!;
    } else {
      const r = seg[i]! ? left / seg[i]! : 0;
      out.push([lerp(a[0], b[0], r), lerp(a[1], b[1], r)]);
      break;
    }
  }
  return out;
}

function head(g: Context2D, tip: [number, number], from: [number, number], sw: number) {
  const ang = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const [L, W] = [sw * 3.6, sw * 2.4];
  const [bx, by] = [tip[0] - Math.cos(ang) * L, tip[1] - Math.sin(ang) * L];
  const [nx, ny] = [-Math.sin(ang) * W, Math.cos(ang) * W];
  g.beginPath();
  g.moveTo(tip[0] + Math.cos(ang) * sw * 0.6, tip[1] + Math.sin(ang) * sw * 0.6);
  g.lineTo(bx + nx, by + ny);
  g.lineTo(bx - nx, by - ny);
  g.closePath();
  g.fill();
}

export interface DrawCtx {
  fonts: Fonts;
  env: Env;
  images: Map<string, CanvasImageSource>;
}

function one(g: Context2D, d: Live, c: DrawCtx) {
  if (d.o <= 0.003) return;
  g.save();
  g.globalAlpha = Math.min(1, d.o);
  if (d.reveal !== undefined && d.reveal < 1) {
    // Shown from the left edge of its box: a little past it, for strokes and descenders.
    const b = bbox(d);
    const pad = 24;
    g.beginPath();
    g.rect(b.x - pad, b.y - pad, (b.w + pad * 2) * Math.max(0, d.reveal), b.h + pad * 2);
    g.clip();
  }
  if (d.dx || d.dy) g.translate(d.dx ?? 0, d.dy ?? 0);
  // Blur is in canvas pixels, so it scales with the view like everything else.
  if (d.blur && d.blur > 0.2) g.filter = `blur(${d.blur * g.getTransform().a}px)`;
  if (d.sc !== undefined && d.sc !== 1) {
    const [cx, cy] = d.t === "circle" ? [d.cx, d.cy] : d.t === "path" ? d.pts[0]! : [d.x + d.w / 2, d.y + d.h / 2];
    g.translate(cx, cy);
    g.scale(d.sc, d.sc);
    g.translate(-cx, -cy);
  }
  switch (d.t) {
    case "rect":
      g.beginPath();
      g.roundRect(d.x, d.y, d.w, d.h, Math.max(0, Math.min(d.r, d.w / 2, d.h / 2)));
      if (d.fill) (g.fillStyle = d.fill), g.fill();
      if (d.stroke) (g.strokeStyle = d.stroke), (g.lineWidth = d.sw ?? 1), g.stroke();
      break;
    case "circle":
      g.beginPath();
      g.arc(d.cx, d.cy, Math.max(0, d.r), 0, Math.PI * 2);
      if (d.fill) (g.fillStyle = d.fill), g.fill();
      if (d.stroke) (g.strokeStyle = d.stroke), (g.lineWidth = d.sw ?? 1), g.stroke();
      break;
    case "path": {
      if (d.prog <= 0) break;
      const pts = partial(d.pts, d.prog);
      const tip = pts.at(-1)!;
      const showHead = d.head !== "none" && d.prog > 0.02;
      // Pull the line back so it ends under the arrowhead, not past it.
      const body = pts.slice();
      if (showHead) {
        const from = pts.at(-2)!;
        const len = Math.hypot(tip[0] - from[0], tip[1] - from[1]) || 1;
        const back = Math.min(len, d.sw * 2.5);
        body[body.length - 1] = [tip[0] - ((tip[0] - from[0]) / len) * back, tip[1] - ((tip[1] - from[1]) / len) * back];
      }
      g.strokeStyle = g.fillStyle = d.stroke;
      g.lineWidth = d.sw;
      g.lineCap = "round";
      g.lineJoin = "round";
      g.beginPath();
      body.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])));
      g.stroke();
      if (showHead) head(g, tip, pts.at(-2)!, d.sw);
      break;
    }
    case "text": {
      const F = c.fonts;
      g.font = F.css(d.font, d.size);
      g.letterSpacing = `${d.track * d.size}px`;
      g.fillStyle = d.color;
      g.textBaseline = "alphabetic";
      g.textAlign = "left";
      const lineH = d.size * d.lh;
      const m = F.metrics(d.font);
      const [asc, desc] = [m.asc * d.size, m.desc * d.size];
      let left = d.chars ?? Infinity;
      d.lines.forEach((full, i) => {
        if (left <= 0) return;
        const chars = [...full];
        const line = chars.slice(0, Math.max(0, left)).join("");
        left -= chars.length;
        const base = d.y + i * lineH + (lineH - asc - desc) / 2 + asc;
        // Aligned by the full line's width, so typed text doesn't slide.
        let x = d.x;
        if (d.align !== "start") {
          const lw = F.measure(full, d.font, d.size, d.track);
          x = d.align === "center" ? d.x + (d.w - lw) / 2 : d.x + d.w - lw;
        }
        g.fillText(line, x, base);
      });
      break;
    }
    case "image": {
      const img = c.images.get(d.src);
      if (!img) break;
      g.beginPath();
      g.roundRect(d.x, d.y, d.w, d.h, Math.max(0, Math.min(d.r, d.w / 2, d.h / 2)));
      g.clip();
      g.drawImage(img, d.x, d.y, d.w, d.h);
      break;
    }
    case "paint": {
      // Drawn on its own layer first: the code may set globalAlpha or blend
      // modes itself, which must not leak into the fade or onto the frame.
      const k = g.getTransform().a;
      const layer = c.env.createCanvas(Math.max(1, Math.ceil(d.w * k)), Math.max(1, Math.ceil(d.h * k)));
      const lg = layer.getContext("2d");
      lg.scale(k, k);
      d.fn(lg, d.now ?? 0, d.w, d.h);
      g.drawImage(layer as unknown as CanvasImageSource, d.x, d.y, d.w, d.h);
      break;
    }
  }
  g.restore();
}

/** Paint `ds` in order. The transform maps stage units to the canvas. */
export function drawLive(g: Context2D, ds: Live[], c: DrawCtx): void {
  for (const d of ds) one(g, d, c);
}

/**
 * Paint layers in order, each under its camera: `anchor` is the stage point
 * a camera's (x, y) is shown at. The transform maps stage units to the canvas.
 */
export function drawLayers(g: Context2D, layers: Layer[], c: DrawCtx, anchor: { x: number; y: number }, H: number): void {
  for (const l of layers) {
    if ((l.o ?? 1) <= 0.003) continue;
    g.save();
    if (l.clipW !== undefined) {
      g.beginPath();
      g.rect(0, 0, Math.max(0, l.clipW), H);
      g.clip();
    }
    if (l.dx) g.translate(l.dx, 0);
    if (l.cam) camera(g, l.cam, anchor);
    const o = l.o ?? 1;
    drawLive(g, o < 1 ? l.ds.map((d) => ({ ...d, o: d.o * o })) : l.ds, c);
    g.restore();
  }
}

function camera(g: Context2D, cam: Cam, anchor: { x: number; y: number }) {
  g.translate(anchor.x, anchor.y);
  g.scale(cam.s, cam.s);
  g.translate(-cam.x, -cam.y);
}
