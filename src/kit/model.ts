// What a laid-out keyframe is made of: flat, absolutely placed drawables.
// Parts become these; the engine only ever interpolates drawables.
// ------------------------------------------------------------------
import type { Context2D } from "../canvas/types.ts";
import type { FontRole } from "./theme.ts";

/** How a part comes in when it first appears. Everything else is a plain move. */
export type Verb = "fade" | "rise" | "draw" | "type" | "count" | "pop" | "none" | "from-left" | "from-right" | "from-top" | "from-bottom" | "wipe" | "blur";

/** How long each verb takes by default, in ms; an enter's `ms` stretches it to that. */
export const VERB_MS: Record<Verb, number> = {
  fade: 400, rise: 550, draw: 650, type: 1400, count: 1100, pop: 450, none: 0,
  "from-left": 650, "from-right": 650, "from-top": 650, "from-bottom": 650, wipe: 600, blur: 600,
};

type Base = {
  id: string;
  /** opacity */
  o: number;
  enter?: Verb;
  /** the top-level part this belongs to: the checker reads overlaps by it */
  owner: string;
  /** what it comes in with, when not its owner (a figure's item): a cue names it */
  turn?: string;
  /** what it becomes later in its scene, in order: each moves it there from the form before */
  steps?: Step[];
  /** a dashed stroke: on and off lengths, as setLineDash takes them */
  dash?: number[];
};

/**
 * A later form of a drawable within its scene: from `at` ms after the scene
 * starts, it moves to `d` over `ms`. Before the reel times it, `cue` names
 * the sentence and `at` the delay after it.
 */
export type Step = { at?: number; cue?: number; ms?: number; d: Drawable };

export type RectD = Base & {
  t: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
  fill?: string;
  stroke?: string;
  sw?: number;
  /** a rect other things sit on (a card), for the contrast and spill checks */
  ground?: boolean;
};

export type TextD = Base & {
  t: "text";
  x: number;
  y: number;
  w: number;
  h: number;
  lines: string[];
  font: FontRole;
  size: number;
  lh: number;
  track: number;
  color: string;
  align: "start" | "center" | "end";
  /** characters shown so far (for "type"); undefined = all */
  chars?: number;
  /** the width its widest line wanted, for the overflow check */
  need: number;
  /** runs set in `mark` instead of `color`, per line, as [from, to) code points */
  marks?: Array<Array<[number, number]>>;
  mark?: string;
};

export type PathD = Base & {
  t: "path";
  pts: [number, number][];
  /** "" for a filled shape with no outline */
  stroke: string;
  sw: number;
  /** 0..1 of the length drawn (for "draw") */
  prog: number;
  head: "none" | "end";
  /** a closed shape filled with this, its outline drawn only with a stroke */
  fill?: string;
};

export type CircleD = Base & {
  t: "circle";
  cx: number;
  cy: number;
  r: number;
  fill?: string;
  stroke?: string;
  sw?: number;
};

export type ImageD = Base & {
  t: "image";
  x: number;
  y: number;
  w: number;
  h: number;
  /** the path it was loaded from: the same src under the same id moves */
  src: string;
  r: number;
  /** corners drawn square, as they meet the frame's edge: top-left, top-right, bottom-right, bottom-left */
  square?: [boolean, boolean, boolean, boolean];
};

/** A box drawn by code: fn paints a w×h area at the reel's time ms. */
export type PaintD = Base & {
  t: "paint";
  x: number;
  y: number;
  w: number;
  h: number;
  /** the same key in the next keyframe: the box moves; another key: crossfade */
  key: string;
  fn: (g: Context2D, ms: number, w: number, h: number) => void;
};

export type Drawable = RectD | TextD | PathD | CircleD | ImageD | PaintD;

export type Bounds = { x: number; y: number; w: number; h: number };

export function bbox(d: Drawable): Bounds {
  switch (d.t) {
    case "circle":
      return { x: d.cx - d.r, y: d.cy - d.r, w: d.r * 2, h: d.r * 2 };
    case "path": {
      const xs = d.pts.map((p) => p[0]);
      const ys = d.pts.map((p) => p[1]);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }
    default:
      return { x: d.x, y: d.y, w: d.w, h: d.h };
  }
}
