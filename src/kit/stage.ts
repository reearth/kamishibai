// A scene's parts placed on the stage: the heading on top (beside a corner
// part on a wide stage), the rest centred below, and room kept at the foot
// for captions and at every edge for the view's insets.
// ------------------------------------------------------------------
import type { Insets } from "../canvas/types.ts";
import { layout, type Box } from "./layout.ts";
import type { Drawable } from "./model.ts";
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

/** Lay out one scene on the stage, as drawables in paint order. */
export function layoutScene(scene: NormScene, ctx: Ctx): Drawable[] {
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
    kids: [...top, { style: { grow: 1, justify: "center", align: "center", gap: 48 }, kids: body.map(own) }],
  };
  return layout(root, W, H);
}
