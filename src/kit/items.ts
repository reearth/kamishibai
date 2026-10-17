// Drawing as data: rects, circles, lines and text, each with an optional id.
// A figure part places them in its own units, and morph() in a canvas reel's;
// either way the same id in the next keyframe moves the item there.
// ------------------------------------------------------------------
import type { Paint } from "./layout.ts";
import type { Verb } from "./model.ts";
import type { Fonts } from "./text.ts";
import { SIZE, type FontRole, type Theme } from "./theme.ts";

export type FigureItem = {
  id?: string;
  enter?: Verb;
  /** in a figure: come in as this sentence of the scene's say starts */
  cue?: number;
  rect?: [number, number, number, number];
  circle?: [number, number, number];
  line?: [number, number][];
  text?: string;
  /** a text's anchor */
  pos?: [number, number];
  fill?: string;
  stroke?: string;
  /** a line's or an outline's width */
  lineWidth?: number;
  r?: number;
  arrow?: boolean;
  size?: number;
  color?: string;
  bold?: boolean;
  align?: "start" | "center" | "end";
};

const SHAPES = ["rect", "circle", "line", "text"] as const;
const KEYS = [...SHAPES, "id", "enter", "pos", "fill", "stroke", "lineWidth", "r", "arrow", "size", "color", "bold", "align"];
const isNums = (v: unknown, n?: number) => Array.isArray(v) && (n === undefined || v.length === n) && v.every((x) => typeof x === "number" && isFinite(x));

/** What is wrong with a list of items, each message led by `at`. `extra` names the fields this use adds (cue, delay). */
export function checkItems(items: unknown, at: string, extra: readonly string[]): string[] {
  if (!Array.isArray(items)) return [];
  const keys = [...KEYS, ...extra];
  const out: string[] = [];
  items.forEach((it, i) => {
    const where = `${at}[${i}]`;
    if (!it || typeof it !== "object") return void out.push(`${where}: expected an item ({ rect | circle | line | text, … })`);
    const unknown = Object.keys(it).filter((k) => !keys.includes(k));
    if (unknown.length) out.push(`${where}: unknown field${unknown.length === 1 ? "" : "s"} ${unknown.map((k) => `"${k}"`).join(", ")}; an item takes ${keys.join(", ")}`);
    const kinds = SHAPES.filter((k) => it[k] !== undefined);
    if (kinds.length !== 1) return void out.push(`${where}: give one of ${SHAPES.join(", ")} (got ${kinds.length ? kinds.join(" and ") : "none"})`);
    if (it.rect !== undefined && !isNums(it.rect, 4)) out.push(`${where}.rect: expected [x, y, w, h]`);
    if (it.circle !== undefined && !isNums(it.circle, 3)) out.push(`${where}.circle: expected [cx, cy, r]`);
    if (it.line !== undefined && (!Array.isArray(it.line) || it.line.length < 2 || !it.line.every((p: unknown) => isNums(p, 2)))) out.push(`${where}.line: expected two points or more, [[x, y], …]`);
    if (it.text !== undefined && (typeof it.text !== "string" || !isNums(it.pos, 2))) out.push(`${where}: a text needs text and pos: [x, y]`);
  });
  const ids = items.map((it, i) => (it && typeof it === "object" ? (it.id ?? String(i)) : String(i)));
  for (const id of new Set(ids.filter((x, i) => ids.indexOf(x) !== i))) out.push(`${at}: the id "${id}" is used twice`);
  return out;
}

/** A theme colour by name (accent, ink, ink3, card…), or a CSS colour as it is. */
function colour(c: string | undefined, theme: Theme, fallback: string): string {
  if (!c) return fallback;
  const named = (theme as unknown as Record<string, unknown>)[c];
  return typeof named === "string" ? named : c;
}

/** Where an item's units land: `k` units per item unit, from (x, y). */
export type Place = { x: number; y: number; k: number };

/** One item as a drawable, with `base` (its id, opacity and verb) laid over. */
export function itemPaint(it: FigureItem, base: { id: string; o: number; enter?: Verb; turn?: string }, at: Place, T: Theme, fonts: Fonts): Paint {
  const { k } = at;
  const X = (x: number) => at.x + x * k;
  const Y = (y: number) => at.y + y * k;
  if (it.rect) {
    const [x, y, w, h] = it.rect;
    return { ...base, t: "rect", x: X(x), y: Y(y), w: w * k, h: h * k, r: (it.r ?? 0) * k, fill: it.fill || it.stroke ? (it.fill ? colour(it.fill, T, T.card) : undefined) : T.card, stroke: it.stroke ? colour(it.stroke, T, T.ink) : undefined, sw: (it.lineWidth ?? 2) * k, ground: !!it.fill };
  }
  if (it.circle) {
    const [cx, cy, rad] = it.circle;
    return { ...base, t: "circle", cx: X(cx), cy: Y(cy), r: rad * k, fill: it.fill || !it.stroke ? colour(it.fill, T, T.ink) : undefined, stroke: it.stroke ? colour(it.stroke, T, T.ink) : undefined, sw: (it.lineWidth ?? 2) * k };
  }
  if (it.line) {
    return { ...base, t: "path", pts: it.line.map(([x, y]) => [X(x), Y(y)] as [number, number]), stroke: colour(it.stroke, T, T.ink), sw: (it.lineWidth ?? 4) * k, prog: 1, head: it.arrow ? "end" : "none" };
  }
  const size = (it.size ?? SIZE.body) * k;
  const font: FontRole = it.bold ? "bold" : "sans";
  const lines = it.text!.split("\n");
  const w = Math.max(...lines.map((l) => fonts.measure(l, font, size)));
  const h = lines.length * size * 1.3;
  const align = it.align ?? "start";
  // pos is the text's top-left (or top-centre, top-right) corner
  const x = X(it.pos![0]) - (align === "center" ? w / 2 : align === "end" ? w : 0);
  return { ...base, t: "text", x, y: Y(it.pos![1]), w, h, lines, font, size, lh: 1.3, track: 0, color: colour(it.color, T, T.ink), align, need: w };
}
