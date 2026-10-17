// The kit's motion without its layout: keyframes of items placed by hand, in
// a canvas reel's own units, at times of the reel's own choosing. An item
// under the same id in the next keyframe moves there, one that is gone fades
// out, and a new one comes in with its verb, as parts do between kit scenes.
// ------------------------------------------------------------------
import type { Context2D, Env } from "../canvas/types.ts";
import { fnv1a64 } from "../fingerprint.ts";
import { check, type Issue } from "./check.ts";
import { drawLayers } from "./draw.ts";
import { layersAt, type Keyframe } from "./engine.ts";
import { checkItems, itemPaint, type FigureItem } from "./items.ts";
import type { Drawable } from "./model.ts";
import { KitSpecError } from "./normalize.ts";
import type { Transition } from "./spec.ts";
import { Fonts } from "./text.ts";
import { mergeTheme, type Theme } from "./theme.ts";

/** An item of a keyframe: a figure's item, with `delay` in place of a cue. */
export type MorphItem = Omit<FigureItem, "cue"> & {
  /** come in this many ms after the keyframe starts, instead of with the rest */
  delay?: number;
};

/** What is on screen from `at` ms until the next keyframe. */
export type MorphFrame = {
  at: number;
  items: MorphItem[];
  /** how it comes in after the keyframe before (default "morph") */
  transition?: Transition;
};

export type MorphOptions = {
  env: Env;
  /** the units the items are placed in: the view's, as a canvas reel's painter draws in */
  width: number;
  height: number;
  /** colours and font families, over the kit's default theme */
  theme?: Partial<Theme>;
  /** a colour (a theme colour's name or CSS) to fill the whole area under each keyframe; a push or a wipe needs one to hide the keyframe before */
  paper?: string;
};

export interface Morph {
  /** Paint the items at `ms`, in `g`'s current units. Returns a fingerprint of what it drew, for a painter that draws nothing else that changes. */
  draw(g: Context2D, ms: number): string;
  /** Text that spills out of a filled rect, items off the area, and weak contrast, with no frame drawn. */
  check(): Issue[];
}

/** Keyframes of items, for a canvas reel to draw from its painter. */
export function morph(frames: MorphFrame[], o: MorphOptions): Morph {
  const problems: string[] = [];
  frames.forEach((fr, i) => {
    if (typeof fr?.at !== "number" || !isFinite(fr.at)) problems.push(`frames[${i}].at: expected a time in ms`);
    else if (i > 0 && fr.at <= frames[i - 1]!.at) problems.push(`frames[${i}].at: ${fr.at} is not after the keyframe before (${frames[i - 1]!.at})`);
    if (!Array.isArray(fr?.items)) problems.push(`frames[${i}].items: expected a list of items`);
    else problems.push(...checkItems(fr.items, `frames[${i}].items`, ["delay"]));
  });
  if (problems.length) throw new KitSpecError(problems);

  const theme = mergeTheme(o.theme);
  const fonts = new Fonts(o.env.createCanvas(1, 1).getContext("2d"), theme);
  const named = (c: string) => ((theme as unknown as Record<string, unknown>)[c] as string | undefined) ?? c;
  const paper: Drawable[] = o.paper ? [{ t: "rect", id: "stage", owner: "stage", x: 0, y: 0, w: o.width, h: o.height, r: 0, o: 1, fill: named(o.paper), ground: true }] : [];
  const place = { x: 0, y: 0, k: 1 };

  const ks: Keyframe[] = frames.map((fr, i) => {
    const cues: Record<string, number> = {};
    const ds = fr.items.map((it, j): Drawable => {
      const id = it.id ?? String(j);
      // Items come in together, but for one with a delay, which takes its own turn.
      if (it.delay !== undefined) cues[id] = it.delay;
      const base = { id, o: 1, enter: it.enter, ...(it.delay !== undefined ? { turn: id } : {}) };
      return { ...itemPaint(it, base, place, theme, fonts), owner: "items" } as Drawable;
    });
    const next = frames[i + 1];
    return { id: `frames[${i}]`, start: fr.at, ms: next ? next.at - fr.at : Infinity, ds: [...paper, ...ds], cues, transition: fr.transition };
  });
  const dc = { fonts, env: o.env, images: new Map<string, CanvasImageSource>() };
  const none = { top: 0, right: 0, bottom: 0, left: 0 };

  return {
    draw(g, ms) {
      const layers = layersAt(ks, ms, o.width);
      drawLayers(g, layers, dc, { x: 0, y: 0 }, o.height);
      return fnv1a64(JSON.stringify(layers));
    },
    check: () => check(ks, { W: o.width, H: o.height }, none, theme, 0),
  };
}
