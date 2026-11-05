// A scene's parts placed on the stage: the heading on top (beside a corner
// part on a wide stage), the rest centred below, and room kept at the foot
// for captions and at every edge for the view's insets.
// ------------------------------------------------------------------
import type { Insets } from "../canvas/types.ts";
import { layout, type Box } from "./layout.ts";
import { bbox, type Bounds, type Drawable, type ImageD } from "./model.ts";
import type { NormScene } from "./normalize.ts";
import { isTall, partDef, rect, type Ctx, type Frame, type Stage } from "./parts.ts";
import type { PartSpec } from "./spec.ts";
import { MIN_FIT } from "./theme.ts";

/** The margins a stage keeps by default, wide or tall (in stage units). */
export function defaultMargin(s: Stage): Frame {
  return isTall(s) ? { top: 120, right: 72, bottom: 120, left: 72 } : { top: 88, right: 96, bottom: 96, left: 96 };
}

/**
 * The margins of a stage (the reel's or the scene's `margin` over the
 * defaults, and no less than `keep` at an edge, where a progress bar is),
 * plus the room captions take at the foot and the view's insets.
 */
export function stageFrame(s: Stage, insets: Insets, captions: boolean, margin: Partial<Frame> = {}, keep: Partial<Frame> = {}): Frame {
  const m = { ...defaultMargin(s), ...margin };
  const at = (k: keyof Frame) => Math.max(m[k], keep[k] ?? 0) + insets[k];
  // Captions take a band above the foot's margin: 104 wide, 240 tall.
  const room = captions ? (isTall(s) ? 240 : 104) : 0;
  return { top: at("top"), right: at("right"), bottom: at("bottom") + room, left: at("left") };
}

/** The box of one part, owned by it. */
export function partBox(spec: PartSpec & { id: string }, ctx: Ctx): Box {
  const def = partDef(spec.type);
  if (!def) throw new Error(`no part "${spec.type}"`);
  return { ...def.box(spec as never, ctx), owner: spec.id };
}

/** Lay out one scene on the stage, as drawables in paint order; `boxes` gets every part's box. */
export function layoutScene(scene: NormScene, ctx: Ctx, boxes?: Map<string, Bounds>): Drawable[] {
  const { W, H } = ctx.stage;
  const fr = ctx.frame;
  const tall = isTall(ctx.stage);
  const def = (p: PartSpec) => partDef(p.type)!;
  const header = scene.parts.filter((p) => def(p).header);
  // A tall stage has no room beside the heading: corner parts lead the body instead.
  const isCorner = (p: (typeof scene.parts)[number]) => !!def(p).corner?.(p as never);
  const corner = tall ? [] : scene.parts.filter((p) => !header.includes(p) && isCorner(p));
  const body = scene.parts
    .filter((p) => !header.includes(p) && !corner.includes(p))
    .sort((a, b) => Number(isCorner(b)) - Number(isCorner(a)));
  const top: Box[] = [];
  const own = (p: PartSpec & { id: string }) => partBox(p, ctx);
  if (header.length || corner.length) {
    top.push({
      style: { dir: "row", gap: 48, align: "start" },
      kids: [
        { style: { gap: 16, grow: 1, shrink: 1 }, kids: header.map(own) },
        ...corner.map((p) => {
          const b = own(p);
          return { ...b, style: { ...b.style, shrink: 0 } };
        }),
      ],
    });
  }
  // The room under the heading, which a part may size itself to (a picture fills it).
  const room = { w: W - fr.left - fr.right, h: H - fr.top - fr.bottom - (top.length ? headH(top[0]!, W, H, fr) + GAP_TOP : 0) };
  const inRoom: Ctx = { ...ctx, room, child: (p, flow) => partBox(p as PartSpec & { id: string }, { ...inRoom, flow }) };
  const root: Box = {
    style: { w: W, h: H, pad: [fr.top, fr.right, fr.bottom, fr.left], gap: GAP_TOP },
    paint: (r) => [rect("stage", r, { fill: ctx.theme.paper, ground: true, enter: "none" })],
    // The parts keep their own height: one too tall for the room is shrunk whole below, never squeezed into the next.
    kids: [...top, { style: { grow: 1, gap: 48, ...PLACE[scene.place] }, kids: body.map((p) => unsqueezed(partBox(p, inRoom))), owner: BODY }],
  };
  const placed = new Map<string, Bounds>();
  const ds = layout(root, W, H, placed);
  const area = placed.get(BODY)!;
  placed.delete(BODY);
  const inBody = new Set(body.flatMap(ids));
  // Too large for the room: shrunk to fit it, whatever fill says. Room to spare: grown with fill.
  const fit = fitScale(ds, inBody, area);
  const k = fit < 1 ? fit : scene.fill ? fillScale(ds, inBody, area, scene.fill === "max" ? MAX_FILL : typeof scene.fill === "number" ? scene.fill : undefined) : 1;
  if (k !== 1) {
    // Grown about where it is placed in the room, so it stays there: its middle, or an edge.
    const c = bounds(ds.filter((d) => inBody.has(d.owner)).flatMap(reach));
    const pl = scene.place;
    const at = {
      x: pl.endsWith("left") ? area.x + (c.w * k) / 2 : pl.endsWith("right") ? area.x + area.w - (c.w * k) / 2 : area.x + area.w / 2,
      y: pl.startsWith("top") ? area.y + (c.h * k) / 2 : pl.startsWith("bottom") ? area.y + area.h - (c.h * k) / 2 : area.y + area.h / 2,
    };
    const move = (x: number, y: number): [number, number] => [at.x + (x - c.x - c.w / 2) * k, at.y + (y - c.y - c.h / 2) * k];
    for (let i = 0; i < ds.length; i++) if (inBody.has(ds[i]!.owner)) ds[i] = grow(ds[i]!, k, move);
    for (const [id, b] of placed) {
      if (!inBody.has(id)) continue;
      const [x, y] = move(b.x, b.y);
      placed.set(id, { x, y, w: b.w * k, h: b.h * k });
    }
  }
  for (const [id, b] of placed) boxes?.set(id, b);
  // A picture that reaches the frame's edge has square corners there, not a rounded one cut against it.
  return ds.map((d) => (d.t === "image" ? edged(d, W, H) : d));
}

/** An image with the corners square where it meets the stage's edge. */
function edged(d: ImageD, W: number, H: number): ImageD {
  const at = { l: d.x <= 0.5, t: d.y <= 0.5, r: d.x + d.w >= W - 0.5, b: d.y + d.h >= H - 0.5 };
  const square: ImageD["square"] = [at.l || at.t, at.r || at.t, at.r || at.b, at.l || at.b];
  return square.some(Boolean) ? { ...d, square } : d;
}

/** A part's id and the ids of every part inside it. */
function ids(p: PartSpec & { id: string }): string[] {
  const kids = (partDef(p.type)?.children?.(p as never) ?? []) as Array<PartSpec & { id: string }>;
  return [p.id, ...kids.flatMap(ids)];
}

/** The owner of the box the body is laid out in (never a part's id: it has a dot-less "@"). */
const BODY = "@body";
/** Space between the heading and the body. */
const GAP_TOP = 56;

/** A box that keeps its height in a column that is too short for it. */
const unsqueezed = (b: Box): Box => ({ ...b, style: { ...b.style, shrink: 0 } });

/** How tall the heading row is, laid out across the stage. */
function headH(top: Box, W: number, H: number, fr: Frame): number {
  const at = new Map<string, Bounds>();
  layout({ style: { w: W, pad: [0, fr.right, 0, fr.left] }, kids: [{ ...top, owner: "@top" }] }, W, H, at);
  return at.get("@top")?.h ?? 0;
}

/** How far the body parts must shrink to fit `area` (1 when they fit, or draw by code), no further than MIN_FIT. */
function fitScale(ds: Drawable[], own: Set<string>, area: Bounds): number {
  const mine = ds.filter((d) => own.has(d.owner));
  if (!mine.length || mine.some((d) => d.t === "paint")) return 1;
  const c = bounds(mine.flatMap(reach));
  const k = Math.min(area.w / Math.max(1, c.w), area.h / Math.max(1, c.h));
  // A scene over its room by a hair is left as it is: it still clears the safe area.
  return k < 0.98 ? Math.max(MIN_FIT, k) : 1;
}
/** How far the body grows at most, and how much of its room it may take. */
const FILL_MAX = 1.6;
const FILL_W = 0.9;
const FILL_H = 0.9;

/** How far the body parts grow with fill: "max": as large as fits the room. */
const MAX_FILL = 4;

/** Where the body sits in its room, as its box's flexbox style. */
const PLACE = {
  center: { justify: "center", align: "center" },
  left: { justify: "center", align: "start" },
  right: { justify: "center", align: "end" },
  top: { justify: "start", align: "center" },
  bottom: { justify: "end", align: "center" },
  "top-left": { justify: "start", align: "start" },
  "top-right": { justify: "start", align: "end" },
  "bottom-left": { justify: "end", align: "start" },
  "bottom-right": { justify: "end", align: "end" },
} as const;

/** How much the body parts may grow to fill `area` (1 when they nearly do, or draw by code): up to `max` times and all of the room, or by default. */
function fillScale(ds: Drawable[], own: Set<string>, area: Bounds, max?: number): number {
  const mine = ds.filter((d) => own.has(d.owner));
  if (!mine.length || mine.some((d) => d.t === "paint")) return 1;
  const c = bounds(mine.flatMap(reach));
  const [most, fw, fh] = max !== undefined ? [max, 1, 1] : [FILL_MAX, FILL_W, FILL_H];
  const k = Math.min(most, (area.w * fw) / Math.max(1, c.w), (area.h * fh) / Math.max(1, c.h));
  return k > 1.05 ? k : 1;
}

/** Every box a drawable takes in its scene: as it comes in, and after each step. */
const reach = (d: Drawable): Bounds[] => [d, ...(d.steps?.map((s) => s.d) ?? [])].map(bbox);

function bounds(bs: Bounds[]): Bounds {
  const x = Math.min(...bs.map((b) => b.x));
  const y = Math.min(...bs.map((b) => b.y));
  return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y };
}

/** A drawable `k` times bigger, its top-left (or centre, or points) moved by `move`. */
function grow(d: Drawable, k: number, move: (x: number, y: number) => [number, number]): Drawable {
  const g = growOne(d, k, move);
  return d.steps ? { ...g, steps: d.steps.map((s) => ({ ...s, d: growOne(s.d, k, move) })) } : g;
}

function growOne(d: Drawable, k: number, move: (x: number, y: number) => [number, number]): Drawable {
  switch (d.t) {
    case "circle": {
      const [cx, cy] = move(d.cx, d.cy);
      return { ...d, cx, cy, r: d.r * k, ...(d.sw !== undefined ? { sw: d.sw * k } : {}) };
    }
    case "path":
      return { ...d, pts: d.pts.map(([x, y]) => move(x, y)), sw: d.sw * k };
    default: {
      const [x, y] = move(d.x, d.y);
      const out = { ...d, x, y, w: d.w * k, h: d.h * k };
      if (out.t === "text") return { ...out, size: out.size * k, need: out.need * k };
      if (out.t === "rect") return { ...out, r: out.r * k, ...(out.sw !== undefined ? { sw: out.sw * k } : {}) };
      if (out.t === "image") return { ...out, r: out.r * k };
      return out;
    }
  }
}
