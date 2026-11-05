// Drawing as data: rects, circles, lines and text, each with an optional id.
// A figure part places them in its own units, and morph() in a canvas reel's;
// either way the same id in the next keyframe moves the item there.
// ------------------------------------------------------------------
import type { Paint } from "./layout.ts";
import type { Drawable, Step, Verb } from "./model.ts";
import type { Fonts } from "./text.ts";
import type { Vector } from "./svg.ts";
import { SIZE, type FontRole, type Theme } from "./theme.ts";

/**
 * A coordinate: a number in the figure's units, or an edge of an item before
 * it, by id, and an offset: "syl1.right+16", "w3.bottom", "title.cx".
 */
export type Coord = number | string;

export type FigureItem = {
  id?: string;
  enter?: Verb;
  /** in a figure: come in as this sentence of the scene's say starts */
  cue?: number;
  rect?: [Coord, Coord, number, number];
  /** a rect by two corners: [x1, y1, x2, y2] */
  box?: [Coord, Coord, Coord, Coord];
  circle?: [Coord, Coord, number];
  line?: [Coord, Coord][];
  text?: string;
  /** an SVG path: its data ("M…"), or an .svg file next to the reel, placed at pos, size tall */
  path?: string;
  /** a path's own box, for path data: its size (24 by default, as most icons) or [w, h] */
  view?: number | [number, number];
  /** fill a path by the even-odd rule (for icons whose holes need it) */
  evenodd?: boolean;
  /** the path the item draws, once read (set as items are resolved) */
  vector?: Vector;
  /** a text's or a path's anchor */
  pos?: [Coord, Coord];
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

const SHAPES = ["rect", "box", "circle", "line", "text", "path"] as const;
const KEYS = [...SHAPES, "id", "enter", "pos", "fill", "stroke", "lineWidth", "r", "arrow", "size", "color", "bold", "mono", "font", "width", "opacity", "dash", "align", "view", "evenodd", "then"];
const STEP_KEYS = [...SHAPES.filter((k) => k !== "box" && k !== "path"), "pos", "fill", "stroke", "lineWidth", "r", "size", "color", "opacity", "ms"];
const ROLES = ["sans", "bold", "black", "mono"];
/** Path data written in the item (the rest is a file to read). */
const isPathData = (s: string) => /^\s*[Mm]/.test(s);
/** A path's size by default, in the figure's units. */
const PATH_SIZE = 48;

/** The path an item draws: its own data in its view (24 × 24 by default), or a file `read` reads. */
function vectorOf(it: FigureItem, read?: (file: string) => Vector): Vector {
  if (!isPathData(it.path!)) {
    if (!read) throw new Error(`a path from a file (${it.path}) needs the reel's files`);
    return read(it.path!);
  }
  const [vw, vh] = Array.isArray(it.view) ? it.view : [it.view ?? 24, it.view ?? 24];
  return { d: it.path!, vx: 0, vy: 0, vw, vh };
}

/** An edge of an item, by id, and an offset: "syl1.right+16". */
const REF = /^([A-Za-z0-9_-]+)\.(left|right|top|bottom|cx|cy)\s*(?:([+-])\s*(\d+(?:\.\d+)?))?$/;
const isCoord = (v: unknown) => (typeof v === "number" && isFinite(v)) || typeof v === "string";
/** The strings an item gives where a coordinate goes. */
function refsOf(it: Record<string, unknown>): string[] {
  const at = (v: unknown, n: number[]) => (Array.isArray(v) ? n.map((i) => v[i]).filter((x): x is string => typeof x === "string") : []);
  return [
    ...at(it.rect, [0, 1]),
    ...at(it.box, [0, 1, 2, 3]),
    ...at(it.circle, [0, 1]),
    ...at(it.pos, [0, 1]),
    ...(Array.isArray(it.line) ? it.line.flatMap((p) => at(p, [0, 1])) : []),
  ];
}

/** An item's box in the figure's units, from its own numbers (a text measured in the reel's fonts). */
function itemBox(it: FigureItem, fonts: Fonts): { x: number; y: number; w: number; h: number } {
  const n = (v: Coord | undefined) => v as number;
  if (it.rect) return { x: n(it.rect[0]), y: n(it.rect[1]), w: it.rect[2], h: it.rect[3] };
  if (it.circle) return { x: n(it.circle[0]) - it.circle[2], y: n(it.circle[1]) - it.circle[2], w: it.circle[2] * 2, h: it.circle[2] * 2 };
  if (it.line) {
    const xs = it.line.map((p) => n(p[0]));
    const ys = it.line.map((p) => n(p[1]));
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
  if (it.vector) {
    const h = it.size ?? PATH_SIZE;
    const w = (h * it.vector.vw) / it.vector.vh;
    const align = it.align ?? "start";
    return { x: n(it.pos![0]) - (align === "center" ? w / 2 : align === "end" ? w : 0), y: n(it.pos![1]), w, h };
  }
  // A text scales with its size, so it is measured at its own size, in the figure's units.
  const size = it.size ?? SIZE.body;
  const font: FontRole = it.font ?? (it.mono ? "mono" : it.bold ? "bold" : "sans");
  const lines = it.width ? fonts.balance(it.text!, font, size, it.width) : it.text!.split("\n");
  const w = Math.max(...lines.map((l) => fonts.measure(l, font, size)));
  const align = it.align ?? "start";
  return { x: n(it.pos![0]) - (align === "center" ? w / 2 : align === "end" ? w : 0), y: n(it.pos![1]), w, h: lines.length * size * 1.3 };
}

/**
 * The items with every coordinate a number: an edge of an item before it
 * ("syl1.right+16") becomes that item's edge, measured in the reel's fonts
 * and theme, plus the offset; a box becomes the rect between its corners.
 * checkItems has made sure each named item comes before.
 */
export function resolveItems<T extends FigureItem>(items: T[], fonts: Fonts, read?: (file: string) => Vector): T[] {
  const boxes = new Map<string, { x: number; y: number; w: number; h: number }>();
  const at = (v: Coord): number => {
    if (typeof v === "number") return v;
    const m = REF.exec(v);
    const b = m ? boxes.get(m[1]!) : undefined;
    if (!m || !b) return 0;
    const edge = { left: b.x, right: b.x + b.w, top: b.y, bottom: b.y + b.h, cx: b.x + b.w / 2, cy: b.y + b.h / 2 }[m[2] as "left"]!;
    return edge + (m[4] ? (m[3] === "-" ? -1 : 1) * Number(m[4]) : 0);
  };
  return items.map((it) => {
    const out: T = { ...it };
    if (it.rect) out.rect = [at(it.rect[0]), at(it.rect[1]), it.rect[2], it.rect[3]];
    if (it.box) {
      const [x1, y1, x2, y2] = it.box.map(at) as [number, number, number, number];
      delete out.box;
      out.rect = [Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)];
    }
    if (it.circle) out.circle = [at(it.circle[0]), at(it.circle[1]), it.circle[2]];
    if (it.line) out.line = it.line.map(([x, y]) => [at(x), at(y)]);
    if (it.pos) out.pos = [at(it.pos[0]), at(it.pos[1])];
    if (it.path) out.vector = vectorOf(it, read);
    if (it.id !== undefined) boxes.set(it.id, itemBox(out, fonts));
    return out;
  });
}

const isNums = (v: unknown, n?: number) => Array.isArray(v) && (n === undefined || v.length === n) && v.every((x) => typeof x === "number" && isFinite(x));

/** What is wrong with a list of items, each message led by `at`. `extra` names the fields this use adds (cue, delay). */
export function checkItems(items: unknown, at: string, extra: readonly string[]): string[] {
  if (!Array.isArray(items)) return [];
  const keys = [...KEYS, ...extra];
  const out: string[] = [];
  const seen = new Set<string>();
  items.forEach((it, i) => {
    const where = `${at}[${i}]`;
    if (!it || typeof it !== "object") return void out.push(`${where}: expected an item ({ rect | circle | line | text, … })`);
    const unknown = Object.keys(it).filter((k) => !keys.includes(k));
    if (unknown.length) out.push(`${where}: unknown field${unknown.length === 1 ? "" : "s"} ${unknown.map((k) => `"${k}"`).join(", ")}; an item takes ${keys.join(", ")}`);
    const kinds = SHAPES.filter((k) => it[k] !== undefined);
    if (kinds.length !== 1) return void out.push(`${where}: give one of ${SHAPES.join(", ")} (got ${kinds.length ? kinds.join(" and ") : "none"})`);
    const coords = (v: unknown, n: number) => Array.isArray(v) && v.length === n && v.every(isCoord);
    if (it.rect !== undefined && !(coords(it.rect.slice(0, 2), 2) && isNums(it.rect.slice(2), 2) && it.rect.length === 4)) out.push(`${where}.rect: expected [x, y, w, h]`);
    if (it.box !== undefined && !coords(it.box, 4)) out.push(`${where}.box: expected [x1, y1, x2, y2], its corners`);
    if (it.circle !== undefined && !(Array.isArray(it.circle) && it.circle.length === 3 && coords(it.circle.slice(0, 2), 2) && isNums(it.circle.slice(2), 1))) out.push(`${where}.circle: expected [cx, cy, r]`);
    if (it.line !== undefined && (!Array.isArray(it.line) || it.line.length < 2 || !it.line.every((p: unknown) => coords(p, 2)))) out.push(`${where}.line: expected two points or more, [[x, y], …]`);
    else if (it.line !== undefined && it.fill !== undefined && it.line.length < 3) out.push(`${where}.line: a filled line is a closed shape, so it needs three points or more`);
    if (it.text !== undefined && (typeof it.text !== "string" || !coords(it.pos, 2))) out.push(`${where}: a text needs text and pos: [x, y]`);
    if (it.path !== undefined) {
      if (typeof it.path !== "string" || !(isPathData(it.path) || /\.svg$/i.test(it.path))) out.push(`${where}.path: expected path data ("M…") or an .svg file next to the reel`);
      if (!coords(it.pos, 2)) out.push(`${where}: a path needs pos: [x, y], its top-left corner (top-centre with align: center)`);
      if (it.size !== undefined && !(typeof it.size === "number" && it.size > 0)) out.push(`${where}.size: expected how tall it is, in the figure's units`);
    }
    if (it.view !== undefined) {
      if (typeof it.path !== "string" || !isPathData(it.path)) out.push(`${where}.view: only path data takes view (an .svg file has its own viewBox)`);
      else if (!((typeof it.view === "number" && it.view > 0) || (isNums(it.view, 2) && it.view.every((v: number) => v > 0)))) out.push(`${where}.view: expected the path's own size, 24, or [w, h]`);
    }
    // An edge named in a coordinate is an item's before this one.
    for (const ref of refsOf(it)) {
      const m = REF.exec(ref);
      if (!m) out.push(`${where}: "${ref}" is not a coordinate: a number, or an item's edge such as "syl1.right" or "w3.bottom+8" (left, right, top, bottom, cx, cy)`);
      else if (!seen.has(m[1]!)) {
        const later = items.slice(i + 1).some((o: { id?: unknown }) => o && o.id === m[1]);
        out.push(`${where}: "${ref}" names ${later ? `"${m[1]}", which comes after it: an item's edges are known once it is placed, so put "${m[1]}" first` : `no item "${m[1]}" before it`}`);
      }
    }
    if (typeof it.id === "string") seen.add(it.id);
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
    const [x, y, w, h] = it.rect as [number, number, number, number];
    return { ...base, t: "rect", x: X(x), y: Y(y), w: w * k, h: h * k, r: (it.r ?? 0) * k, fill: it.fill || it.stroke ? (it.fill ? colour(it.fill, T, T.card) : undefined) : T.card, stroke: it.stroke ? colour(it.stroke, T, T.ink) : undefined, sw: (it.lineWidth ?? 2) * k, ground: !!it.fill, ...dash };
  }
  if (it.circle) {
    const [cx, cy, rad] = it.circle as [number, number, number];
    return { ...base, t: "circle", cx: X(cx), cy: Y(cy), r: rad * k, fill: it.fill || !it.stroke ? colour(it.fill, T, T.ink) : undefined, stroke: it.stroke ? colour(it.stroke, T, T.ink) : undefined, sw: (it.lineWidth ?? 2) * k, ...dash };
  }
  if (it.line) {
    const pts = (it.line as [number, number][]).map(([x, y]) => [X(x), Y(y)] as [number, number]);
    // With a fill, the points close into a shape, outlined only with a stroke.
    if (it.fill) return { ...base, t: "path", pts, fill: colour(it.fill, T, T.ink), stroke: it.stroke ? colour(it.stroke, T, T.ink) : "", sw: (it.lineWidth ?? 2) * k, prog: 1, head: "none", ...dash };
    return { ...base, t: "path", pts, stroke: colour(it.stroke, T, T.ink), sw: (it.lineWidth ?? 4) * k, prog: 1, head: it.arrow ? "end" : "none", ...dash };
  }
  if (it.vector) {
    const v = it.vector;
    const h = (it.size ?? PATH_SIZE) * k;
    const w = (h * v.vw) / v.vh;
    const align = it.align ?? "start";
    const x = X(it.pos![0] as number) - (align === "center" ? w / 2 : align === "end" ? w : 0);
    // Drawn as its file says: with lines (an outline icon) or filled; color is the one it is drawn in.
    const lines = v.lineWidth !== undefined;
    const fill = lines ? (it.fill ? colour(it.fill, T, T.ink) : undefined) : colour(it.fill ?? it.color, T, T.ink);
    const stroke = lines ? colour(it.stroke ?? it.color, T, T.ink) : it.stroke ? colour(it.stroke, T, T.ink) : undefined;
    return { ...base, t: "vector", x, y: Y(it.pos![1] as number), w, h, d: v.d, vx: v.vx, vy: v.vy, vw: v.vw, vh: v.vh, ...(fill ? { fill } : {}), ...(stroke ? { stroke } : {}), lw: it.lineWidth ?? v.lineWidth ?? 1, ...(it.evenodd ? { evenodd: true } : {}) } as Paint;
  }
  const size = (it.size ?? SIZE.body) * k;
  const font: FontRole = it.font ?? (it.mono ? "mono" : it.bold ? "bold" : "sans");
  const lines = it.width ? fonts.balance(it.text!, font, size, it.width * k) : it.text!.split("\n");
  const w = Math.max(...lines.map((l) => fonts.measure(l, font, size)));
  const h = lines.length * size * 1.3;
  const align = it.align ?? "start";
  // pos is the text's top-left (or top-centre, top-right) corner
  const x = X(it.pos![0] as number) - (align === "center" ? w / 2 : align === "end" ? w : 0);
  return { ...base, t: "text", x, y: Y(it.pos![1] as number), w, h, lines, font, size, lh: 1.3, track: 0, color: colour(it.color, T, T.ink), align, need: w };
}
