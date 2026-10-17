// Draw every Lexicon term with no browser: PAINT terms run unchanged on a
// Skia canvas, SHAPES terms are drawn from their CSS-ish fields. Fonts go
// through kamishibai's canvas host (registerFonts, patchContext), so a
// variable font draws at the weight asked for, as in a canvas reel.
import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { patchContext, registerFonts } from "../../src/canvas/node.ts";
import type { CanvasReel, Context2D } from "../../src/canvas/types.ts";
import { FONTS, FONT_DIR } from "./fonts.ts";

await registerFonts({ fonts: FONTS } as unknown as CanvasReel, FONT_DIR);
const canvas = (w: number, h: number) => {
  const c = createCanvas(w, h);
  patchContext(c.getContext("2d") as unknown as Context2D);
  return c;
};

// The drawings make scratch canvases with document.createElement("canvas");
// outside a browser there is no document, so give them one that can.
if (typeof document === "undefined") (globalThis as Record<string, unknown>).document = { createElement: () => canvas(1, 1) };

const { SHAPES, PAINT, W, H } = await import("../../site/src/lib/draw.ts");
export { SHAPES, PAINT, W, H };

type Shape = import("../../site/src/lib/draw.ts").Shape;
const unknown = new Set<string>();
export const unsupported = unknown;

const num = (s: string) => parseFloat(s);
/** "12.5%" of a length, or plain px */
const len = (s: string, of: number) => (s.trim().endsWith("%") ? (num(s) / 100) * of : num(s));

function shape(g: SKRSContext2D, s: Shape) {
  const x = len(s.left, W), y = len(s.top, H), w = len(s.width, W), h = len(s.height, H);
  if (s.opacity <= 0) return;
  g.save();
  g.globalAlpha = s.opacity;
  const [ox, oy] = s.transformOrigin.split(/\s+/).map((v, i) => len(v, i ? h : w));
  if (s.transform !== "none") {
    g.translate(x + ox!, y + oy!);
    for (const [, fn, args] of s.transform.matchAll(/(\w+)\(([^)]*)\)/g)) {
      const a = args!.split(/\s*,\s*|\s+/).filter(Boolean);
      if (fn === "translate") g.translate(len(a[0]!, w), len(a[1] ?? "0", h));
      else if (fn === "translateX") g.translate(len(a[0]!, w), 0);
      else if (fn === "translateY") g.translate(0, len(a[0]!, h));
      else if (fn === "rotate") g.rotate((num(a[0]!) * Math.PI) / 180);
      else if (fn === "scale") g.scale(num(a[0]!), num(a[1] ?? a[0]!));
      else if (fn === "scaleX") g.scale(num(a[0]!), 1);
      else if (fn === "scaleY") g.scale(1, num(a[0]!));
      else if (fn === "skewX") g.transform(1, 0, Math.tan((num(a[0]!) * Math.PI) / 180), 1, 0, 0);
      else unknown.add(`transform ${fn}`);
    }
    g.translate(-(x + ox!), -(y + oy!));
  }
  if (s.filter !== "none") {
    const b = /blur\(([\d.]+)px\)/.exec(s.filter);
    if (b) g.filter = `blur(${b[1]}px)`;
    else unknown.add(`filter ${s.filter}`);
  }
  if (s.boxShadow !== "none") {
    const m = /(-?[\d.]+)(?:px)?\s+(-?[\d.]+)(?:px)?\s+([\d.]+)(?:px)?\s+(rgba?\([^)]*\)|#\w+)/.exec(s.boxShadow);
    if (m) [g.shadowOffsetX, g.shadowOffsetY, g.shadowBlur, g.shadowColor] = [num(m[1]!), num(m[2]!), num(m[3]!), m[4]!];
    else unknown.add(`boxShadow ${s.boxShadow}`);
  }
  g.fillStyle = paint(g, s.background, x, y, w, h);
  g.beginPath();
  const r = s.borderRadius === "50%" ? null : len(s.borderRadius, Math.min(w, h));
  if (r === null) g.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  else g.roundRect(x, y, w, h, r);
  g.fill();
  g.restore();
}

/** A CSS background: a colour, or `radial-gradient(circle at X% Y%, c p%, …)`. */
function paint(g: SKRSContext2D, bg: string, x: number, y: number, w: number, h: number) {
  const m = /^radial-gradient\(circle at ([\d.]+)% ([\d.]+)%,\s*(.*)\)$/.exec(bg);
  if (!m) {
    if (/gradient/.test(bg)) unknown.add(`background ${bg.slice(0, 40)}`);
    return bg;
  }
  const cx = x + (num(m[1]!) / 100) * w, cy = y + (num(m[2]!) / 100) * h;
  // CSS's default size for a circle is the distance to the farthest corner.
  const r = Math.max(...[[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([px, py]) => Math.hypot(px! - cx, py! - cy)));
  const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
  for (const stop of m[3]!.split(/,\s*(?![^(]*\))/)) {
    const [, c, p] = /^(\S+)\s+([\d.]+)%$/.exec(stop.trim())!;
    grad.addColorStop(num(p!) / 100, c!);
  }
  return grad;
}

/** Paint term `id` at loop time t (0..1) into a 400×300 area of `g`. */
export function paintTerm(g: SKRSContext2D, id: string, t: number) {
  if (PAINT[id]) PAINT[id](g as unknown as CanvasRenderingContext2D, t);
  else if (SHAPES[id]) for (const s of SHAPES[id](t)) shape(g, s);
  else throw new Error(`no Lexicon term "${id}"`);
}

/** Draw term `id` at loop time t onto a fresh canvas `scale` times 400×300. */
export function draw(id: string, t: number, scale = 2, bg = "#ffffff") {
  const c = canvas(W * scale, H * scale);
  const g = c.getContext("2d");
  g.scale(scale, scale);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  paintTerm(g, id, t);
  return c;
}
