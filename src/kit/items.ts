// Drawing as data: rects, circles, lines and text, each with an optional id.
// A figure part places them in its own units, and morph() in a canvas reel's;
// either way the same id in the next keyframe moves the item there.
// ------------------------------------------------------------------
import type { Paint } from "./layout.ts";
import type { Drawable, Step, Verb } from "./model.ts";
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
  /** set in the theme's mono font (code, identifiers) */
  mono?: boolean;
  /** a text's font role: sans, bold, black (a heading's) or mono; over bold and mono */
  font?: FontRole;
  /** a text wraps at this width, in the figure's units (default: only at "\n") */
  width?: number;
  /** 0 (unseen) to 1 (default) */
  opacity?: number;
  /** a dashed stroke: [on, off] lengths in the figure's units */
  dash?: number[];
  align?: "start" | "center" | "end";
  /** what it becomes later in the scene, in order: it moves from each form to the next */
  then?: ItemStep[];
};

/**
 * A later form of an item: the fields it changes (its shape's own field, pos,
 * colours, sizes), and when. In a figure it moves `delay` ms (default 0) after
 * sentence `cue` (default 0) starts; in morph, `delay` ms after the keyframe
 * starts. `ms` is how long the move takes (default 750).
 */
export type ItemStep = Partial<Pick<FigureItem, "rect" | "circle" | "line" | "text" | "pos" | "fill" | "stroke" | "lineWidth" | "r" | "size" | "color" | "opacity">> & { cue?: number; delay?: number; ms?: number };

const SHAPES = ["rect", "circle", "line", "text"] as const;
const KEYS = [...SHAPES, "id", "enter", "pos", "fill", "stroke", "lineWidth", "r", "arrow", "size", "color", "bold", "mono", "font", "width", "opacity", "dash", "align", "then"];
const STEP_KEYS = [...SHAPES, "pos", "fill", "stroke", "lineWidth", "r", "size", "color", "opacity", "ms"];
const ROLES = ["sans", "bold", "black", "mono"];
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
    else if (it.line !== undefined && it.fill !== undefined && it.line.length < 3) out.push(`${where}.line: a filled line is a closed shape, so it needs three points or more`);
    if (it.text !== undefined && (typeof it.text !== "string" || !isNums(it.pos, 2))) out.push(`${where}: a text needs text and pos: [x, y]`);
    if (it.font !== undefined && !ROLES.includes(it.font)) out.push(`${where}.font: "${it.font}" is not one of ${ROLES.map((r) => `"${r}"`).join(", ")}`);
    if (it.width !== undefined && it.text === undefined) out.push(`${where}.width: only a text takes width (where it wraps); a line's or an outline's is lineWidth`);
    else if (it.width !== undefined && !(typeof it.width === "number" && it.width > 0)) out.push(`${where}.width: expected a width in the figure's units`);
    if (it.opacity !== undefined && !(typeof it.opacity === "number" && it.opacity >= 0 && it.opacity <= 1)) out.push(`${where}.opacity: expected 0 to 1`);
    if (it.dash !== undefined && !(isNums(it.dash) && it.dash.length >= 2)) out.push(`${where}.dash: expected [on, off] lengths`);
    if (it.then !== undefined) out.push(...checkSteps(it, kinds[0]!, `${where}.then`, extra));
  });
  const ids = items.map((it, i) => (it && typeof it === "object" ? (it.id ?? String(i)) : String(i)));
  for (const id of new Set(ids.filter((x, i) => ids.indexOf(x) !== i))) out.push(`${at}: the id "${id}" is used twice`);
  return out;
}

/** What is wrong with an item's steps: each keeps its shape, and says when. */
function checkSteps(it: Record<string, unknown>, kind: (typeof SHAPES)[number], at: string, extra: readonly string[]): string[] {
  if (!Array.isArray(it.then)) return [`${at}: expected a list of steps ({ ${extra.includes("cue") ? "cue" : "delay"}, …the fields that change })`];
  const figure = extra.includes("cue");
  const keys = [...STEP_KEYS, ...(figure ? ["cue", "delay"] : ["delay"])];
  const out: string[] = [];
  let last: [number, number] = [-1, -1];
  it.then.forEach((st: Record<string, unknown>, j: number) => {
    const where = `${at}[${j}]`;
    if (!st || typeof st !== "object") return void out.push(`${where}: expected a step ({ ${figure ? "cue, delay?" : "delay"}, …the fields that change })`);
    const unknown = Object.keys(st).filter((k) => !keys.includes(k));
    if (unknown.length) out.push(`${where}: unknown field${unknown.length === 1 ? "" : "s"} ${unknown.map((k) => `"${k}"`).join(", ")}; a step takes ${keys.join(", ")}`);
    const other = SHAPES.filter((k) => k !== kind && st[k] !== undefined);
    if (other.length) out.push(`${where}: a ${kind} stays a ${kind}, so its step can't give ${other.join(" or ")}`);
    const cue = (st.cue ?? 0) as number;
    const delay = (st.delay ?? 0) as number;
    if (figure && !(typeof cue === "number" && Number.isInteger(cue) && cue >= 0)) out.push(`${where}.cue: expected a sentence number`);
    else if (!(typeof delay === "number" && delay >= 0)) out.push(`${where}.delay: expected ms after ${figure ? "its sentence" : "the keyframe"} starts`);
    else if (figure && st.cue === undefined && st.delay === undefined) out.push(`${where}: say when, with cue (a sentence) or delay (ms after the scene starts)`);
    else if (!figure && st.delay === undefined) out.push(`${where}: say when, with delay (ms after the keyframe starts)`);
    else if (cue < last[0] || (cue === last[0] && delay <= last[1])) out.push(`${where}: steps go in order, so this must come after the step before (${figure ? `cue ${last[0]}, ` : ""}delay ${last[1]})`);
    else last = [cue, delay];
    if (st.ms !== undefined && !(typeof st.ms === "number" && st.ms >= 0)) out.push(`${where}.ms: expected ms`);
    if (st.rect !== undefined && !isNums(st.rect, 4)) out.push(`${where}.rect: expected [x, y, w, h]`);
    if (st.circle !== undefined && !isNums(st.circle, 3)) out.push(`${where}.circle: expected [cx, cy, r]`);
    if (st.line !== undefined && (!Array.isArray(st.line) || st.line.length !== (it.line as unknown[] | undefined)?.length || !st.line.every((p: unknown) => isNums(p, 2)))) out.push(`${where}.line: expected as many points as the line has (${(it.line as unknown[] | undefined)?.length ?? 0})`);
    if (st.pos !== undefined && !isNums(st.pos, 2)) out.push(`${where}.pos: expected [x, y]`);
    if (st.text !== undefined && typeof st.text !== "string") out.push(`${where}.text: expected a string`);
    if (st.opacity !== undefined && !(typeof st.opacity === "number" && st.opacity >= 0 && st.opacity <= 1)) out.push(`${where}.opacity: expected 0 to 1`);
  });
  return out;
}

/** An item's steps as drawables, each laid over the item's form before it. */
export function itemSteps(it: FigureItem, base: { id: string; o: number; enter?: Verb; turn?: string }, at: Place, T: Theme, fonts: Fonts): Step[] {
  let form: FigureItem = it;
  return (it.then ?? []).map((st) => {
    const { cue, delay, ms, ...change } = st;
    form = { ...form, ...change };
    return { ...(cue !== undefined ? { cue } : {}), at: delay ?? 0, ms, d: itemPaint(form, base, at, T, fonts) as Drawable };
  });
}

/** A theme colour by name (accent, ink, ink3, card…), or a CSS colour as it is. */
export function colour(c: string | undefined, theme: Theme, fallback: string): string {
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
  base = { ...base, o: base.o * (it.opacity ?? 1) };
  const dash = it.dash ? { dash: it.dash.map((v) => v * k) } : {};
  if (it.rect) {
    const [x, y, w, h] = it.rect;
    return { ...base, t: "rect", x: X(x), y: Y(y), w: w * k, h: h * k, r: (it.r ?? 0) * k, fill: it.fill || it.stroke ? (it.fill ? colour(it.fill, T, T.card) : undefined) : T.card, stroke: it.stroke ? colour(it.stroke, T, T.ink) : undefined, sw: (it.lineWidth ?? 2) * k, ground: !!it.fill, ...dash };
  }
  if (it.circle) {
    const [cx, cy, rad] = it.circle;
    return { ...base, t: "circle", cx: X(cx), cy: Y(cy), r: rad * k, fill: it.fill || !it.stroke ? colour(it.fill, T, T.ink) : undefined, stroke: it.stroke ? colour(it.stroke, T, T.ink) : undefined, sw: (it.lineWidth ?? 2) * k, ...dash };
  }
  if (it.line) {
    const pts = it.line.map(([x, y]) => [X(x), Y(y)] as [number, number]);
    // With a fill, the points close into a shape, outlined only with a stroke.
    if (it.fill) return { ...base, t: "path", pts, fill: colour(it.fill, T, T.ink), stroke: it.stroke ? colour(it.stroke, T, T.ink) : "", sw: (it.lineWidth ?? 2) * k, prog: 1, head: "none", ...dash };
    return { ...base, t: "path", pts, stroke: colour(it.stroke, T, T.ink), sw: (it.lineWidth ?? 4) * k, prog: 1, head: it.arrow ? "end" : "none", ...dash };
  }
  const size = (it.size ?? SIZE.body) * k;
  const font: FontRole = it.font ?? (it.mono ? "mono" : it.bold ? "bold" : "sans");
  const lines = it.width ? fonts.balance(it.text!, font, size, it.width * k) : it.text!.split("\n");
  const w = Math.max(...lines.map((l) => fonts.measure(l, font, size)));
  const h = lines.length * size * 1.3;
  const align = it.align ?? "start";
  // pos is the text's top-left (or top-centre, top-right) corner
  const x = X(it.pos![0]) - (align === "center" ? w / 2 : align === "end" ? w : 0);
  return { ...base, t: "text", x, y: Y(it.pos![1]), w, h, lines, font, size, lh: 1.3, track: 0, color: colour(it.color, T, T.ink), align, need: w };
}
