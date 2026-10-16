// The canvas reel contract: a module whose default export draws a frame on a
// 2D canvas for a time `ms`. Shared by the Node host (rendered with Skia, no
// browser) and the browser host (mountCanvas). No DOM or Node imports here.
// ------------------------------------------------------------------
import type { KamishibaiPage } from "../protocol.ts";

export interface CanvasReelMeta {
  /** ticks per second the renderer samples */
  fps: number;
  /** total reel length in milliseconds; the same for every view */
  durationMs: number;
  /** the default view's size, in layout units */
  width: number;
  height: number;
  /** the shapes (width / height) the reel lays out for; default: only width / height */
  aspect?: { min: number; max: number };
  title?: string;
}

/** A font file the reel draws with, as a path relative to the reel's module. */
export interface FontSource {
  family: string;
  src: string;
  /** a number, or "100 900" for a variable font's range (default 400) */
  weight?: number | string;
  style?: "normal" | "italic";
}

/** Space the picture should keep clear of, in layout units. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * What the frames are for. Plain data: copied to workers and hashed into cache
 * keys. Fields after width and height have defaults, so a reel ignores the ones
 * it doesn't know and new ones never break it.
 */
export interface View {
  /** layout units across and down */
  width: number;
  height: number;
  /** output pixels per layout unit */
  pixelRatio: number;
  /** where the frames go: an encoded file, kamishibai's player, or a page that embeds the reel */
  medium: "video" | "player" | "embed";
  /** space to keep clear of: an app's own controls laid over a vertical video */
  insets: Insets;
}

/** The 2D context a painter draws on: the part a browser and Skia share. */
export type Context2D = CanvasRenderingContext2D;

/** An offscreen canvas from Env.createCanvas. */
export interface CanvasLike {
  width: number;
  height: number;
  getContext(type: "2d"): Context2D;
}

/** What differs between Node and a browser, behind one object per host. */
export interface Env {
  /** an offscreen canvas, for layers and scratch work */
  createCanvas(width: number, height: number): CanvasLike;
  /** an image file, relative to the reel's module */
  loadImage(path: string): Promise<CanvasImageSource>;
  /** a text file next to the reel (such as source code it quotes) */
  readText(path: string): string;
}

/**
 * Draw the frame at `ms`. `g` is already scaled by view.pixelRatio, so it is
 * drawn in layout units. Same return values as seek(): `false` = identical to
 * the previous frame, a string = this frame's fingerprint, void = draw it.
 */
export type Painter = (g: Context2D, ms: number) => boolean | string | void;

export interface CanvasReel {
  meta: CanvasReelMeta;
  /** font files to register before setup runs */
  fonts?: FontSource[];
  /** audio and subtitle markers, the same shapes as a page's */
  audio?: KamishibaiPage["audio"];
  subtitles?: KamishibaiPage["subtitles"];
  /** called once per view, before any of its frames: do layout here, return the painter */
  setup(view: View, env: Env): Painter | Promise<Painter>;
}

/** Type a canvas reel (an identity function, for editor help). */
export function canvasReel(reel: CanvasReel): CanvasReel {
  return reel;
}

export function isCanvasReel(x: unknown): x is CanvasReel {
  const r = x as Partial<CanvasReel> | null;
  return !!r && typeof r === "object" && typeof r.setup === "function" && !!r.meta && typeof r.meta.fps === "number";
}

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

export interface ViewRequest {
  /** an exact size in layout units */
  size?: { width: number; height: number };
  /** a shape as width / height ("9:16" or a number); the long side keeps meta's */
  aspect?: string | number;
  pixelRatio?: number;
  medium?: View["medium"];
  insets?: Partial<Insets>;
}

/** Parse "9:16", "1.5" or a number into width / height. */
export function parseAspect(a: string | number): number {
  if (typeof a === "number") return a;
  const m = /^\s*([\d.]+)\s*[:/x]\s*([\d.]+)\s*$/.exec(a);
  const r = m ? Number(m[1]) / Number(m[2]) : Number(a);
  if (!(r > 0) || !isFinite(r)) throw new Error(`not an aspect ratio: "${a}" (expected e.g. 9:16)`);
  return r;
}

/** The shapes a reel lays out for; a reel without meta.aspect has only its own. */
export function aspectRange(meta: CanvasReelMeta): { min: number; max: number } {
  return meta.aspect ?? { min: meta.width / meta.height, max: meta.width / meta.height };
}

/**
 * The view for a request: an explicit size, or an aspect with the long side of
 * meta's size, else meta's own size. The size is rounded to even numbers, which
 * a yuv420p encode needs. Throws when the shape is outside meta.aspect.
 */
export function resolveView(meta: CanvasReelMeta, req: ViewRequest = {}): View {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  let width = meta.width;
  let height = meta.height;
  if (req.size) ({ width, height } = req.size);
  else if (req.aspect !== undefined) {
    const r = parseAspect(req.aspect);
    const long = Math.max(meta.width, meta.height);
    [width, height] = r >= 1 ? [long, long / r] : [long * r, long];
  }
  // The shape is checked as asked for: rounding to even numbers can move a
  // small size's ratio more than any slack would allow (16×9 → 16×10).
  const range = aspectRange(meta);
  const r = width / height;
  if (r < range.min * 0.999 || r > range.max * 1.001) {
    const fmt = (x: number) => x.toFixed(3);
    throw new Error(
      `the reel lays out for width/height ${fmt(range.min)}…${fmt(range.max)} ` +
        `(meta.aspect), not ${width}×${height} (${fmt(r)})`,
    );
  }
  width = even(width);
  height = even(height);
  return {
    width,
    height,
    pixelRatio: req.pixelRatio ?? 1,
    medium: req.medium ?? "video",
    insets: { ...NO_INSETS, ...req.insets },
  };
}

/** A stable key for a view, for cache manifests. */
export function viewKey(v: View): string {
  const i = v.insets;
  return `${v.width}x${v.height}@${v.pixelRatio} ${v.medium} inset ${i.top},${i.right},${i.bottom},${i.left}`;
}

/** Parse "top,right,bottom,left" (or one number for all sides) into insets. */
export function parseInsets(s: string): Insets {
  const n = s.split(",").map((x) => Number(x.trim()));
  if (n.some((x) => !(x >= 0))) throw new Error(`--inset expects numbers ≥ 0 as "top,right,bottom,left", got "${s}"`);
  if (n.length === 1) return { top: n[0]!, right: n[0]!, bottom: n[0]!, left: n[0]! };
  if (n.length === 4) return { top: n[0]!, right: n[1]!, bottom: n[2]!, left: n[3]! };
  throw new Error(`--inset expects 1 or 4 numbers ("top,right,bottom,left"), got "${s}"`);
}

/**
 * Split a CSS font shorthand's weight off: Skia parses only multiples of 100
 * in `font`, so the host puts the nearest one there (it picks a static
 * fallback face) and the exact weight on a variable font's wght axis.
 */
export function splitFontWeight(font: string): { weight: number; rounded: string; families: string[] } | null {
  const m = /^((?:(?:italic|oblique|normal|small-caps)\s+)*)(?:(bold|bolder|lighter|normal|\d+(?:\.\d+)?)\s+)?((?:(?:italic|oblique|small-caps|normal)\s+)*)([\d.]+(?:px|pt|em|rem|%)(?:\/\S+)?\s+.+)$/.exec(font.trim());
  if (!m) return null;
  const w = m[2] === "bold" ? 700 : !m[2] || m[2] === "normal" ? 400 : Number(m[2]);
  if (!isFinite(w)) return null;
  const nearest = Math.min(900, Math.max(100, Math.round(w / 100) * 100));
  const families = m[4]!.replace(/^[\d.]+(?:px|pt|em|rem|%)(?:\/\S+)?\s+/, "").split(",").map((f) => f.trim().replace(/^["']|["']$/g, ""));
  return { weight: w, rounded: `${m[1]}${nearest} ${m[3]}${m[4]}`, families };
}
