// A scene's parts placed on the stage: the heading on top (beside a corner
// part on a wide stage), the rest centred below, and room kept at the foot
// for captions and at every edge for the view's insets.
// ------------------------------------------------------------------
import type { Insets } from "../canvas/types.ts";
import { layout, type Box } from "./layout.ts";
import { bbox, type Bounds, type Drawable } from "./model.ts";
import type { NormScene } from "./normalize.ts";
import { isTall, partDef, rect, type Ctx, type Frame, type Stage } from "./parts.ts";
import type { PartSpec } from "./spec.ts";

/** The margins of a stage, plus the room captions take and the view's insets (in stage units). */
export function stageFrame(s: Stage, insets: Insets, captions: boolean): Frame {
  const tall = isTall(s);
  const side = tall ? 72 : 96;
  const top = tall ? 120 : 88;
  const foot = captions ? (tall ? 360 : 200) : tall ? 120 : 96;
  return { top: top + insets.top, right: side + insets.right, bottom: foot + insets.bottom, left: side + insets.left };
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
  const own = (p: PartSpec & { id: string }) => partBox(p, ctx);
  const top: Box[] = [];
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
  const root: Box = {
    style: { w: W, h: H, pad: [fr.top, fr.right, fr.bottom, fr.left], gap: 56 },
    paint: (r) => [rect("stage", r, { fill: ctx.theme.paper, ground: true, enter: "none" })],
    kids: [...top, { style: { grow: 1, justify: "center", align: "center", gap: 48 }, kids: body.map(own), owner: BODY }],
  };
  const room = new Map<string, Bounds>();
  const ds = layout(root, W, H, room);
  const area = room.get(BODY)!;
  room.delete(BODY);
  const inBody = new Set(body.flatMap(ids));
  const k = scene.fill ? fillScale(ds, inBody, area) : 1;
  if (k > 1) {
    // Grown about the middle of the room, so it stays centred in it.
    const c = bounds(ds.filter((d) => inBody.has(d.owner)).map(bbox));
    const at = { x: area.x + area.w / 2, y: area.y + area.h / 2 };
    const move = (x: number, y: number): [number, number] => [at.x + (x - c.x - c.w / 2) * k, at.y + (y - c.y - c.h / 2) * k];
    for (let i = 0; i < ds.length; i++) if (inBody.has(ds[i]!.owner)) ds[i] = grow(ds[i]!, k, move);
    for (const [id, b] of room) {
      if (!inBody.has(id)) continue;
      const [x, y] = move(b.x, b.y);
      room.set(id, { x, y, w: b.w * k, h: b.h * k });
    }
  }
  for (const [id, b] of room) boxes?.set(id, b);
  return ds;
}

/** A part's id and the ids of every part inside it. */
function ids(p: PartSpec & { id: string }): string[] {
  const kids = (partDef(p.type)?.children?.(p as never) ?? []) as Array<PartSpec & { id: string }>;
  return [p.id, ...kids.flatMap(ids)];
}

/** The owner of the box the body is laid out in (never a part's id: it has a dot-less "@"). */
const BODY = "@body";
/** How far the body grows at most, and how much of its room it may take. */
const FILL_MAX = 1.6;
const FILL_W = 0.9;
const FILL_H = 0.9;

/** How much the body parts may grow to fill `area` (1 when they nearly do, or draw by code). */
function fillScale(ds: Drawable[], own: Set<string>, area: Bounds): number {
  const mine = ds.filter((d) => own.has(d.owner));
  if (!mine.length || mine.some((d) => d.t === "paint")) return 1;
  const c = bounds(mine.map(bbox));
  const k = Math.min(FILL_MAX, (area.w * FILL_W) / Math.max(1, c.w), (area.h * FILL_H) / Math.max(1, c.h));
  return k > 1.05 ? k : 1;
}

function bounds(bs: Bounds[]): Bounds {
  const x = Math.min(...bs.map((b) => b.x));
  const y = Math.min(...bs.map((b) => b.y));
  return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y };
}

/** A drawable `k` times bigger, its top-left (or centre, or points) moved by `move`. */
function grow(d: Drawable, k: number, move: (x: number, y: number) => [number, number]): Drawable {
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
