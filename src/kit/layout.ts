// Flexbox without a browser (Yoga). A part describes itself as a tree of boxes;
// Yoga places them once per keyframe, and each box paints drawables into its rect.
// ------------------------------------------------------------------
import type { Node as YNode } from "yoga-layout";
import type { Bounds, Drawable } from "./model.ts";

type YogaModule = typeof import("yoga-layout");
let Y: YogaModule | undefined;

/** yoga-layout, an optional peer dependency: loaded by kit() before any layout. */
export async function loadYoga(): Promise<void> {
  if (Y) return;
  try {
    Y = await import("yoga-layout");
  } catch {
    throw new Error("a kit reel is laid out with yoga-layout: npm i -D yoga-layout");
  }
}

const yoga = (): YogaModule => {
  if (!Y) throw new Error("kit layout before loadYoga()");
  return Y;
};

export type Rect = { x: number; y: number; w: number; h: number };

export type Style = {
  dir?: "row" | "col";
  gap?: number;
  pad?: number | [number, number] | [number, number, number, number];
  grow?: number;
  shrink?: number;
  align?: "start" | "center" | "end" | "stretch";
  self?: "start" | "center" | "end" | "stretch";
  justify?: "start" | "center" | "end" | "between";
  wrap?: boolean;
  w?: number | `${number}%`;
  h?: number | `${number}%`;
  minW?: number;
  maxW?: number;
  abs?: { top?: number; right?: number; bottom?: number; left?: number };
};

/** A drawable before layout has said which top-level part owns it. */
export type Paint = Drawable extends infer D ? (D extends Drawable ? Omit<D, "owner"> & { owner?: string } : never) : never;

export type Box = {
  style?: Style;
  /** Intrinsic size for a leaf, given the width it may take. */
  measure?: (maxW: number) => { w: number; h: number };
  paint?: (r: Rect) => Paint[];
  kids?: Box[];
  /** Marks the root box of a top-level part. */
  owner?: string;
};

function build(b: Box): YNode {
  const { default: Yoga, Align, Edge, FlexDirection, Gutter, Justify, MeasureMode, PositionType, Wrap } = yoga();
  const aligns = { start: Align.FlexStart, center: Align.Center, end: Align.FlexEnd, stretch: Align.Stretch };
  const justs = { start: Justify.FlexStart, center: Justify.Center, end: Justify.FlexEnd, between: Justify.SpaceBetween };
  const n = Yoga.Node.create();
  const s = b.style ?? {};
  n.setFlexDirection(s.dir === "row" ? FlexDirection.Row : FlexDirection.Column);
  if (s.gap !== undefined) n.setGap(Gutter.All, s.gap);
  if (s.pad !== undefined) {
    const p = typeof s.pad === "number" ? [s.pad, s.pad, s.pad, s.pad] : s.pad.length === 2 ? [s.pad[0], s.pad[1], s.pad[0], s.pad[1]] : s.pad;
    n.setPadding(Edge.Top, p[0]!);
    n.setPadding(Edge.Right, p[1]!);
    n.setPadding(Edge.Bottom, p[2]!);
    n.setPadding(Edge.Left, p[3]!);
  }
  n.setFlexGrow(s.grow ?? 0);
  n.setFlexShrink(s.shrink ?? 1);
  if (s.align) n.setAlignItems(aligns[s.align]);
  if (s.self) n.setAlignSelf(aligns[s.self]);
  if (s.justify) n.setJustifyContent(justs[s.justify]);
  if (s.wrap) n.setFlexWrap(Wrap.Wrap);
  if (s.w !== undefined) n.setWidth(s.w);
  if (s.h !== undefined) n.setHeight(s.h);
  if (s.minW !== undefined) n.setMinWidth(s.minW);
  if (s.maxW !== undefined) n.setMaxWidth(s.maxW);
  if (s.abs) {
    n.setPositionType(PositionType.Absolute);
    for (const [k, e] of [["top", Edge.Top], ["right", Edge.Right], ["bottom", Edge.Bottom], ["left", Edge.Left]] as const) {
      const v = s.abs[k];
      if (v !== undefined) n.setPosition(e, v);
    }
  }
  if (b.measure) {
    const m = b.measure;
    n.setMeasureFunc((w, wMode) => {
      const r = m(wMode === MeasureMode.Undefined ? Infinity : w);
      return { width: wMode === MeasureMode.Exactly ? w : Math.min(r.w, wMode === MeasureMode.AtMost ? w : Infinity), height: r.h };
    });
  }
  (b.kids ?? []).forEach((k, i) => n.insertChild(build(k), i));
  return n;
}

/** The size `b` takes when nothing constrains it (a row's natural width). */
export function intrinsic(b: Box): { w: number; h: number } {
  const yn = build(b);
  yn.calculateLayout(undefined, undefined, yoga().Direction.LTR);
  const l = yn.getComputedLayout();
  yn.freeRecursive();
  return { w: l.width, h: l.height };
}

/**
 * Lay out `root` in a W×H stage and return its drawables in paint order.
 * `boxes`, when given, gets the box of every part (by its owner id).
 */
export function layout(root: Box, W: number, H: number, boxes?: Map<string, Bounds>): Drawable[] {
  const yn = build(root);
  yn.calculateLayout(W, H, yoga().Direction.LTR);
  const out: Drawable[] = [];
  const walk = (b: Box, n: YNode, ox: number, oy: number, owner: string) => {
    const l = n.getComputedLayout();
    const r = { x: ox + l.left, y: oy + l.top, w: l.width, h: l.height };
    const own = b.owner ?? owner;
    if (b.owner && boxes && !boxes.has(b.owner)) boxes.set(b.owner, r);
    for (const p of b.paint?.(r) ?? []) out.push({ ...p, owner: p.owner ?? own } as Drawable);
    (b.kids ?? []).forEach((k, i) => walk(k, n.getChild(i), r.x, r.y, own));
  };
  walk(root, yn, 0, 0, "stage");
  yn.freeRecursive();
  return out;
}
