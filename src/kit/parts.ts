// The parts a keyframe is written with. Each part has an id; a part with the
// same id in the next scene moves there, one that is gone fades out, and a
// new one comes in with its verb. definePart adds a part of your own.
// ------------------------------------------------------------------
import { bbox, type RectD, type Verb } from "./model.ts";
import { intrinsic, layout, type Box, type Paint, type Rect } from "./layout.ts";
import { f, type Fields } from "./fields.ts";
import { SIZE, type FontRole, type Theme } from "./theme.ts";
import type { Fonts } from "./text.ts";
import type {
  ArrowSpec,
  CardSpec,
  ChipSpec,
  GroupSpec,
  ImageSpec,
  ListSpec,
  PaintSpec,
  PartSpec,
  StatSpec,
  TextSpec,
  TitleSpec,
} from "./spec.ts";

/** The size of the stage being laid out, in layout units (the long side is 1920). */
export type Stage = { W: number; H: number };
export const isTall = (s: Stage) => s.H > s.W;

/** The stage's padding: the margins, the room kept for captions, and the view's insets. */
export type Frame = { top: number; right: number; bottom: number; left: number };

/** What a part is laid out with. */
export interface Ctx {
  stage: Stage;
  frame: Frame;
  /** which way the enclosing group runs */
  flow?: "row" | "col";
  fonts: Fonts;
  theme: Theme;
  /** a text file relative to the reel */
  readText(path: string): string;
  /** an image loaded before layout, by its src */
  image(src: string): { img: CanvasImageSource; w: number; h: number } | undefined;
  /** the box of a child part (owned by it, so the checker sees it as one) */
  child(spec: PartSpec, flow?: "row" | "col"): Box;
}

/** A spec with its id filled in. */
export type Placed<S> = S & { id: string };

export interface PartDef<S = Record<string, unknown>> {
  /** the fields it takes, besides `type`, `id` and `enter` */
  fields: Fields;
  /** a line for the schema and `kamishibai skill kit` */
  doc: string;
  box(spec: Placed<S>, ctx: Ctx): Box;
  /** the scene's heading: pinned to the top */
  header?: boolean;
  /** on a wide stage, pinned to the top-right corner */
  corner?(spec: Placed<S>): boolean;
  /** the parts inside it, so they get ids too */
  children?(spec: Placed<S>): PartSpec[];
  /** cues of things inside it (a figure's items), as [turn, sentence] */
  cues?(spec: S): Array<[string, number]>;
  /** problems beyond its fields' kinds, each led by `at` */
  check?(spec: S, at: string): string[];
  /** image files it draws, loaded before layout */
  images?(spec: Placed<S>): string[];
}

const registry = new Map<string, PartDef>();

/** Add a part type. A part of the same name replaces it. */
export function definePart<S>(type: string, def: PartDef<S>): void {
  registry.set(type, def as unknown as PartDef);
}
export const partDef = (type: string): PartDef | undefined => registry.get(type);
export const partTypes = (): string[] => [...registry.keys()];

// ---- text boxes -----------------------------------------------------------

export type TextOpts = {
  font?: FontRole;
  size?: number;
  color?: string;
  lh?: number;
  track?: number;
  align?: "start" | "center" | "end";
  enter?: Verb;
  style?: Box["style"];
  /** even out the lines, so none ends with a word or two alone */
  balance?: boolean;
};

/** A run of text that wraps to the width it gets. */
export function textBox(id: string, s: string, ctx: Ctx, o: TextOpts = {}): Box {
  const font = o.font ?? "sans";
  const size = o.size ?? SIZE.body;
  const lh = o.lh ?? 1.45;
  const track = o.track ?? 0;
  const F = ctx.fonts;
  const lines = (w: number) => (o.balance ? F.balance(s, font, size, w, track) : F.wrap(s, font, size, w, track));
  const widest = (ls: string[]) => Math.max(0, ...ls.map((l) => F.measure(l, font, size, track)));
  return {
    style: o.style,
    measure: (maxW) => {
      const ls = lines(maxW);
      return { w: Math.ceil(widest(ls)), h: ls.length * size * lh };
    },
    paint: (r) => {
      const ls = lines(r.w + 0.5);
      return [
        { t: "text", id, x: r.x, y: r.y, w: r.w, h: r.h, lines: ls, font, size, lh, track, color: o.color ?? ctx.theme.ink, align: o.align ?? "start", o: 1, enter: o.enter, need: widest(ls) },
      ];
    },
  };
}

export const rect = (id: string, r: Rect, p: Partial<Omit<RectD, "t" | "id" | "owner">>): Paint => ({ t: "rect", id, x: r.x, y: r.y, w: r.w, h: r.h, r: 0, o: 1, ...p }) as Paint;

// ---- the parts --------------------------------------------------------------

export const VERBS = ["fade", "rise", "draw", "type", "count", "pop", "none", "from-left", "from-right", "from-top", "from-bottom", "wipe", "blur"] as const;
/** Fields every part takes. */
export const COMMON: Fields = {
  id: f.str("same id in the next scene: the part moves there"),
  enter: f.one(VERBS, "how it comes in when it first appears"),
  cue: f.num("come in as this sentence of the scene's say starts (0 = the first)"),
};

definePart<TitleSpec>("title", {
  doc: "The scene's heading, pinned to the top. Keep the same id across scenes and it stays put while the rest changes.",
  fields: { text: f.str("the heading", true), kicker: f.str("a small line above it") },
  header: true,
  box: (s, ctx) => ({
    style: { gap: 12 },
    kids: [
      ...(s.kicker ? [textBox(`${s.id}.kicker`, s.kicker, ctx, { font: "bold", size: SIZE.small, color: ctx.theme.accentText, track: 0.04 })] : []),
      textBox(s.id, s.text, ctx, { font: "black", size: SIZE.h1, lh: 1.15, track: -0.02, balance: true, enter: s.enter }),
    ],
  }),
});

definePart<TextSpec>("text", {
  doc: 'Plain text. tone "display" is a cover\'s title, "lead" is large, "note" is small and grey.',
  fields: { text: f.str("the text", true), tone: f.one(["display", "lead", "body", "note"]), align: f.one(["start", "center"]) },
  box: (s, ctx) => {
    const tone = s.tone ?? "body";
    if (tone === "display") return textBox(s.id, s.text, ctx, { font: "black", size: SIZE.display, lh: 1.1, track: -0.03, align: s.align ?? "center", balance: true, enter: s.enter });
    return textBox(s.id, s.text, ctx, {
      font: tone === "lead" ? "bold" : "sans",
      size: tone === "lead" ? SIZE.h2 : tone === "note" ? SIZE.small : SIZE.body,
      color: tone === "note" ? ctx.theme.ink3 : ctx.theme.ink,
      enter: s.enter,
      align: s.align,
      balance: s.align === "center",
    });
  },
});

const groupFields: Fields = {
  parts: f.parts("the parts in it", true),
  gap: f.num("space between them"),
  align: f.one(["start", "center", "end", "stretch"]),
  narrow: f.one(["stack", "wrap", "keep"], 'a row that does not fit across: "stack" into a column (default), "wrap" like tiles, or "keep"'),
};

function groupBox(dir: "row" | "col", s: Placed<GroupSpec>, ctx: Ctx): Box {
  const gap = s.gap ?? 48;
  const room = ctx.stage.W - ctx.frame.left - ctx.frame.right;
  const narrowAs = s.narrow ?? "stack";
  // A row fits when its parts, each allowed to wrap down to its narrowest, sit
  // across the room with no word cut and nothing past the edge.
  const fits = () => {
    const kids = s.parts.map((p) => {
      const b = ctx.child(p, "row");
      return { ...b, style: { ...b.style, shrink: 1 } };
    });
    if (intrinsic({ style: { dir: "row", gap }, kids }).w <= room) return true;
    const ds = layout({ style: { w: room }, kids: [{ style: { dir: "row", gap, align: "center" }, kids }] }, room, ctx.stage.H);
    return ds.every((d) => {
      const b = bbox(d);
      return b.x + b.w <= room + 1 && (d.t !== "text" || d.need <= d.w + 1);
    });
  };
  const narrow = dir === "row" && narrowAs !== "keep" && !fits() ? narrowAs : null;
  const d = narrow === "stack" ? "col" : dir;
  return {
    style: {
      dir: d,
      gap: narrow === "stack" ? Math.min(gap, 28) : gap,
      align: s.align ?? (dir === "row" ? "center" : "stretch"),
      justify: "center",
      shrink: 1,
      // A centred row is as wide as its parts want: held to the room, they wrap instead.
      maxW: room,
      ...(narrow ? { self: "stretch" as const } : {}),
      ...(narrow === "wrap" ? { wrap: true, align: "start" as const } : {}),
    },
    kids: s.parts.map((p) => {
      const b = ctx.child(p, d);
      return { ...b, style: { ...b.style, ...(d === "row" && !narrow ? { shrink: 1, grow: b.style?.grow ?? 0 } : {}) } };
    }),
  };
}

definePart<GroupSpec>("row", {
  doc: "Parts side by side. On a narrow stage it stacks into a column (see narrow).",
  fields: groupFields,
  children: (s) => s.parts,
  box: (s, ctx) => groupBox("row", s, ctx),
});
definePart<GroupSpec>("col", {
  doc: "Parts one under another.",
  fields: groupFields,
  children: (s) => s.parts,
  box: (s, ctx) => groupBox("col", s, ctx),
});

function readCode(ref: string, ctx: Ctx): { file?: string; lines: string[]; first: number } {
  const m = /^([^\s#]+\.[A-Za-z0-9]+)#L(\d+)(?:-L?(\d+))?$/.exec(ref);
  if (!m) return { lines: ref.split("\n"), first: 0 };
  const all = ctx.readText(m[1]!).split("\n");
  const at = Number(m[2]);
  const [a, b] = m[3] ? [at, Number(m[3])] : [Math.max(1, at - 1), at + 1];
  return { file: `${m[1]}:${at}`, lines: all.slice(a - 1, b), first: a };
}

function codeBlock(id: string, ref: string, mark: string | undefined, ctx: Ctx): Box {
  const { file, lines, first } = readCode(ref, ctx);
  const T = ctx.theme;
  const F = ctx.fonts;
  const size = SIZE.code;
  const lh = 1.6;
  const gutter = first ? F.measure(String(first + lines.length), "mono", size) + 28 : 0;
  return {
    style: { gap: 12 },
    kids: [
      ...(file ? [textBox(`${id}.file`, file, ctx, { font: "mono", size: SIZE.small - 4, color: T.ink3 })] : []),
      {
        style: { pad: [20, 28], shrink: 0 },
        paint: (r) => [rect(`${id}.well`, r, { fill: T.well, r: 12, ground: true })],
        kids: [
          {
            measure: () => ({ w: gutter + Math.max(0, ...lines.map((l) => F.measure(l, "mono", size))), h: lines.length * size * lh }),
            paint: (r) => {
              const out: Paint[] = [];
              lines.forEach((l, i) => {
                const y = r.y + i * size * lh;
                if (first) out.push({ t: "text", id: `${id}.n${first + i}`, x: r.x, y, w: gutter - 28, h: size * lh, lines: [String(first + i)], font: "mono", size, lh, track: 0, color: T.ink3, align: "end", o: 1, need: 0 } as Paint);
                const at = mark ? l.indexOf(mark) : -1;
                if (at >= 0) {
                  const x0 = r.x + gutter + F.measure(l.slice(0, at), "mono", size);
                  out.push(rect(`${id}.mark`, { x: x0 - 6, y: y + 4, w: F.measure(mark!, "mono", size) + 12, h: size * lh - 8 }, { fill: T.accentTint, r: 6, enter: "pop" }));
                }
              });
              // One drawable per source line, keyed by its line number, so a line
              // still on screen in the next scene slides instead of retyping.
              lines.forEach((l, i) => {
                const key = first ? `${id}.L${first + i}` : `${id}.L${i}`;
                out.push({ t: "text", id: key, x: r.x + gutter, y: r.y + i * size * lh, w: r.w - gutter, h: size * lh, lines: [l], font: "mono", size, lh, track: 0, color: T.ink, align: "start", o: 1, enter: "type", need: F.measure(l, "mono", size) } as Paint);
              });
              return out;
            },
          },
        ],
      },
    ],
  };
}

definePart<CardSpec>("card", {
  doc: 'A paper card: a small label over a sentence, a code excerpt, or both. code is text or "path#L40-48" from the reel\'s folder.',
  fields: {
    label: f.str("a small line on top"),
    body: f.str("a sentence"),
    code: f.str('code as text, or "path#L44" / "path#L40-48"'),
    mark: f.str("a substring of the code to highlight"),
    tone: f.one(["plain", "accent", "dim"]),
    width: f.num("its width on a wide stage"),
  },
  box: (s, ctx) => {
    const T = ctx.theme;
    const tone = s.tone ?? "plain";
    return {
      // In a column on a tall stage a card takes the full width instead of its own.
      style: { pad: 44, gap: 20, shrink: 0, minW: 360, ...(isTall(ctx.stage) && ctx.flow !== "row" ? { self: "stretch" as const } : { w: s.width }) },
      paint: (r) => [
        rect(s.id, r, { fill: tone === "dim" ? T.well : T.card, stroke: tone === "accent" ? T.accent : T.rule, sw: tone === "accent" ? 4 : 2, r: 20, ground: true, enter: s.enter }),
      ],
      kids: [
        ...(s.label ? [textBox(`${s.id}.label`, s.label, ctx, { font: "bold", size: SIZE.small, color: tone === "accent" ? T.accentText : tone === "dim" ? T.ink2 : T.ink3 })] : []),
        ...(s.body ? [textBox(`${s.id}.body`, s.body, ctx, { font: "bold", size: SIZE.h2 - 4, lh: 1.35, color: tone === "dim" ? T.ink3 : T.ink })] : []),
        ...(s.code ? [codeBlock(`${s.id}.code`, s.code, s.mark, ctx)] : []),
      ],
    };
  },
});

definePart<ArrowSpec>("arrow", {
  doc: 'An arrow between parts in a row (it turns down in a column), or "versus" (≠) / "equals" (=) between two to compare.',
  fields: { kind: f.one(["right", "down", "versus", "equals"]) },
  box: (s, ctx) => {
    const T = ctx.theme;
    const kind = (s.kind ?? "right") === "right" && ctx.flow === "col" ? "down" : (s.kind ?? "right");
    const line = (id: string, pts: [number, number][], stroke: string, sw: number, head: "none" | "end") => ({ t: "path", id, pts, stroke, sw, prog: 1, head, o: 1, enter: s.enter ?? "draw" }) as Paint;
    return {
      style: { w: kind === "down" ? 80 : 140, h: kind === "down" ? 96 : 80, shrink: 0, self: "center" },
      paint: (r) => {
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        if (kind === "versus" || kind === "equals") {
          const out = [line(`${s.id}.a`, [[cx - 36, cy - 14], [cx + 36, cy - 14]], T.accent, 8, "none"), line(`${s.id}.b`, [[cx - 36, cy + 14], [cx + 36, cy + 14]], T.accent, 8, "none")];
          if (kind === "versus") out.push(line(`${s.id}.x`, [[cx + 20, cy - 40], [cx - 20, cy + 40]], T.accent, 8, "none"));
          return out;
        }
        const pts: [number, number][] = kind === "down" ? [[cx, r.y + 8], [cx, r.y + r.h - 8]] : [[r.x + 12, cy], [r.x + r.w - 12, cy]];
        return [line(s.id, pts, T.ink, 6, "end")];
      },
    };
  },
});

definePart<ChipSpec>("chip", {
  doc: 'A pill, for a step in a flow. state "active" fills it with the accent; "done" greys it and ticks it. n numbers it.',
  fields: { text: f.str("the label", true), state: f.one(["active", "done"]), n: f.num("a number in a badge before the label (a tick once done)") },
  box: (s, ctx) => {
    const T = ctx.theme;
    const on = s.state === "active";
    const done = s.state === "done";
    const d = Math.round(SIZE.body * 0.95);
    // A badge: the step's number, or a tick once it is done.
    const badge: Box[] =
      s.n !== undefined || done
        ? [
            {
              style: { w: d, h: d, shrink: 0 },
              paint: (r) => {
                const cx = r.x + d / 2;
                const cy = r.y + d / 2;
                const ring = on ? T.onAccent : done ? T.ink3 : T.accent;
                const out: Paint[] = [{ t: "circle", id: `${s.id}.badge`, cx, cy, r: d / 2, stroke: ring, sw: 3, o: 1 } as Paint];
                if (done) {
                  const u = d / 2;
                  out.push({ t: "path", id: `${s.id}.tick`, pts: [[cx - u * 0.45, cy + u * 0.02], [cx - u * 0.1, cy + u * 0.36], [cx + u * 0.48, cy - u * 0.34]], stroke: ring, sw: 5, prog: 1, head: "none", o: 1, enter: "draw" } as Paint);
                } else {
                  out.push({ t: "text", id: `${s.id}.n`, x: r.x, y: cy - SIZE.small * 0.62, w: d, h: SIZE.small * 1.24, lines: [String(s.n)], font: "bold", size: SIZE.small, lh: 1.24, track: 0, color: on ? T.onAccent : T.accentText, align: "center", o: 1, need: 0 } as Paint);
                }
                return out;
              },
            },
          ]
        : [];
    return {
      style: { dir: "row", align: "center", gap: 16, pad: [22, badge.length ? 32 : 40], shrink: 0 },
      paint: (r) => [rect(s.id, r, { r: r.h / 2, fill: on ? T.accent : done ? T.well : T.card, stroke: on ? T.accent : T.rule, sw: 2, ground: true, enter: s.enter })],
      kids: [...badge, textBox(`${s.id}.t`, s.text, ctx, { font: "bold", size: SIZE.body, color: on ? T.onAccent : done ? T.ink2 : T.ink })],
    };
  },
});

definePart<StatSpec>("stat", {
  doc: "A big number that counts up from its previous value (or 0).",
  fields: { value: f.num("the number", true), unit: f.str(), label: f.str("a line under it"), tone: f.one(["plain", "accent"]), digits: f.num("decimals shown (default: as many as the value has)") },
  box: (s, ctx) => {
    const T = ctx.theme;
    // As many decimals as the value is written with, unless told.
    const digits = s.digits ?? (String(s.value).split(".")[1]?.length ?? 0);
    const v = s.value.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
    return {
      style: { gap: 8, align: "center" },
      kids: [
        {
          style: { dir: "row", align: "end", gap: 12 },
          kids: [
            textBox(`${s.id}.v`, v, ctx, { font: "mono", size: SIZE.stat, lh: 1.05, color: s.tone === "accent" ? T.accentText : T.ink, track: -0.04, enter: "count" }),
            ...(s.unit ? [textBox(`${s.id}.u`, s.unit, ctx, { font: "bold", size: SIZE.h2, lh: 1.6, color: T.ink2 })] : []),
          ],
        },
        ...(s.label ? [textBox(`${s.id}.l`, s.label, ctx, { font: "bold", size: SIZE.body, color: T.ink3, align: "center" })] : []),
      ],
    };
  },
});

definePart<ListSpec>("list", {
  doc: "A bulleted list; mark picks one item to stress. Each item keeps its own id, so an item still there slides.",
  fields: { items: f.strs("the items", true), mark: f.num("the index of the item to stress") },
  box: (s, ctx) => {
    const T = ctx.theme;
    return {
      style: { gap: 28 },
      kids: s.items.map((item, i) => ({
        style: { dir: "row", gap: 24, align: "start" },
        kids: [
          {
            style: { w: 18, h: SIZE.body * 1.45, shrink: 0 },
            paint: (r) => [{ t: "circle", id: `${s.id}.${i}.dot`, cx: r.x + 9, cy: r.y + r.h / 2, r: 9, fill: s.mark === i ? T.accent : T.ink, o: 1 } as Paint],
          },
          textBox(`${s.id}.${i}`, item, ctx, { font: s.mark === i ? "bold" : "sans", size: SIZE.body, color: s.mark === undefined || s.mark === i ? T.ink : T.ink3, style: { shrink: 1 } }),
        ],
      })),
    };
  },
});

definePart<ImageSpec>("image", {
  doc: "A picture from a file next to the reel, fitted to the room it gets.",
  fields: { src: f.str("a path relative to the reel", true), width: f.num(), height: f.num(), caption: f.str("a small line under it") },
  images: (s) => [s.src],
  box: (s, ctx) => {
    const im = ctx.image(s.src);
    const ratio = im && im.w > 0 ? im.h / im.w : 0.5625;
    const maxH = s.height ?? ctx.stage.H * 0.5;
    const pic: Box = {
      measure: (maxW) => {
        let w = Math.min(maxW, s.width ?? im?.w ?? 960);
        if (w * ratio > maxH) w = maxH / ratio;
        return { w, h: w * ratio };
      },
      style: { shrink: 1 },
      paint: (r) => [{ t: "image", id: s.id, x: r.x, y: r.y, w: r.w, h: r.h, src: s.src, r: 16, o: 1, enter: s.enter ?? "fade" } as Paint],
    };
    if (!s.caption) return pic;
    return { style: { gap: 16, align: "center" }, kids: [pic, textBox(`${s.id}.caption`, s.caption, ctx, { size: SIZE.small, color: ctx.theme.ink3, align: "center" })] };
  },
});

definePart<PaintSpec>("paint", {
  doc: "A box drawn by code, on the reel's clock (only in a code reel).",
  fields: { width: f.num("in layout units", true), height: f.num("in layout units", true), key: f.str("another key crossfades"), fn: f.fn("(g, ms, w, h) => void", true) },
  box: (s) => ({
    style: { w: s.width, h: s.height, shrink: 0 },
    paint: (r) => [{ t: "paint", id: s.id, x: r.x, y: r.y, w: r.w, h: r.h, key: s.key ?? s.id, fn: s.fn, o: 1, enter: s.enter ?? "fade" } as Paint],
  }),
});

// ---- constructors, for a reel written in code -----------------------------

type Opt<S, K extends keyof S> = Omit<S, "type" | K>;
export const title = (text: string, o: Opt<TitleSpec, "text"> = {}): TitleSpec => ({ type: "title", text, ...o });
export const text = (text: string, o: Opt<TextSpec, "text"> = {}): TextSpec => ({ type: "text", text, ...o });
export const row = (parts: PartSpec[], o: Opt<GroupSpec, "parts"> = {}): GroupSpec => ({ type: "row", parts, ...o });
export const col = (parts: PartSpec[], o: Opt<GroupSpec, "parts"> = {}): GroupSpec => ({ type: "col", parts, ...o });
export const card = (o: Opt<CardSpec, never>): CardSpec => ({ type: "card", ...o });
export const arrow = (o: Opt<ArrowSpec, never> = {}): ArrowSpec => ({ type: "arrow", ...o });
export const chip = (text: string, o: Opt<ChipSpec, "text"> = {}): ChipSpec => ({ type: "chip", text, ...o });
export const stat = (value: number, o: Opt<StatSpec, "value"> = {}): StatSpec => ({ type: "stat", value, ...o });
export const list = (items: string[], o: Opt<ListSpec, "items"> = {}): ListSpec => ({ type: "list", items, ...o });
export const image = (src: string, o: Opt<ImageSpec, "src"> = {}): ImageSpec => ({ type: "image", src, ...o });
export const paint = (o: Opt<PaintSpec, never>): PaintSpec => ({ type: "paint", ...o });

// ---- figure: drawing as data ----------------------------------------------

type FigureItem = {
  id?: string;
  enter?: Verb;
  cue?: number;
  rect?: [number, number, number, number];
  circle?: [number, number, number];
  line?: [number, number][];
  text?: string;
  /** a text's anchor */
  at?: [number, number];
  fill?: string;
  stroke?: string;
  /** a line's or an outline's width */
  width?: number;
  r?: number;
  arrow?: boolean;
  size?: number;
  color?: string;
  bold?: boolean;
  align?: "start" | "center" | "end";
};
type FigureSpec = { id: string; type: "figure"; width: number; height: number; items: FigureItem[]; caption?: string };

const SHAPES = ["rect", "circle", "line", "text"] as const;
const isNums = (v: unknown, n?: number) => Array.isArray(v) && (n === undefined || v.length === n) && v.every((x) => typeof x === "number" && isFinite(x));
const itemId = (s: { id: string }, it: FigureItem, i: number) => `${s.id}.${it.id ?? i}`;

/** A theme colour by name (accent, ink, ink3, card…), or a CSS colour as it is. */
function colour(c: string | undefined, theme: Theme, fallback: string): string {
  if (!c) return fallback;
  const named = (theme as unknown as Record<string, unknown>)[c];
  return typeof named === "string" ? named : c;
}

definePart<FigureSpec>("figure", {
  doc: "A drawing as data: rects, circles, lines and text in its own width × height units, fitted to the room it gets. Each item may have an id (the same id in the next scene moves it) and a cue.",
  fields: {
    width: f.num("its units across", true),
    height: f.num("its units down", true),
    items: f.list('{ rect: [x, y, w, h] } | { circle: [cx, cy, r] } | { line: [[x, y], …], arrow? } | { text, at: [x, y], size?, bold?, align? }, with fill, stroke, width, r, color (a theme colour name or CSS), id, enter, cue', true),
    caption: f.str("a small line under it"),
  },
  check: (s, at) => {
    if (!Array.isArray(s.items)) return [];
    const out: string[] = [];
    s.items.forEach((it, i) => {
      const where = `${at}.items[${i}]`;
      if (!it || typeof it !== "object") return void out.push(`${where}: expected an item ({ rect | circle | line | text, … })`);
      const kinds = SHAPES.filter((k) => it[k] !== undefined);
      if (kinds.length !== 1) return void out.push(`${where}: give one of ${SHAPES.join(", ")} (got ${kinds.length ? kinds.join(" and ") : "none"})`);
      if (it.rect !== undefined && !isNums(it.rect, 4)) out.push(`${where}.rect: expected [x, y, w, h]`);
      if (it.circle !== undefined && !isNums(it.circle, 3)) out.push(`${where}.circle: expected [cx, cy, r]`);
      if (it.line !== undefined && (!Array.isArray(it.line) || it.line.length < 2 || !it.line.every((p) => isNums(p, 2)))) out.push(`${where}.line: expected two points or more, [[x, y], …]`);
      if (it.text !== undefined && (typeof it.text !== "string" || !isNums(it.at, 2))) out.push(`${where}: a text needs text and at: [x, y]`);
    });
    const ids = s.items.map((it, i) => (it && typeof it === "object" ? (it.id ?? String(i)) : String(i)));
    for (const id of new Set(ids.filter((x, i) => ids.indexOf(x) !== i))) out.push(`${at}.items: the id "${id}" is used twice`);
    return out;
  },
  cues: (s) => (Array.isArray(s.items) ? s.items.flatMap((it, i) => (typeof it?.cue === "number" ? [[itemId(s, it, i), it.cue] as [string, number]] : [])) : []),
  box: (s, ctx) => {
    const T = ctx.theme;
    const maxH = ctx.stage.H * 0.6;
    const pic: Box = {
      style: { shrink: 1 },
      measure: (maxW) => {
        let w = Math.min(maxW, s.width);
        if ((w * s.height) / s.width > maxH) w = (maxH * s.width) / s.height;
        return { w, h: (w * s.height) / s.width };
      },
      paint: (r) => {
        const k = r.w / s.width;
        const X = (x: number) => r.x + x * k;
        const Y = (y: number) => r.y + y * k;
        return s.items.map((it, i): Paint => {
          // An item with a cue comes in on its own turn; the rest with the figure.
          const base = { id: itemId(s, it, i), ...(it.cue ? { turn: itemId(s, it, i) } : {}), o: 1, enter: it.enter };
          if (it.rect) {
            const [x, y, w, h] = it.rect;
            return { ...base, t: "rect", x: X(x), y: Y(y), w: w * k, h: h * k, r: (it.r ?? 0) * k, fill: it.fill || it.stroke ? (it.fill ? colour(it.fill, T, T.card) : undefined) : T.card, stroke: it.stroke ? colour(it.stroke, T, T.ink) : undefined, sw: (it.width ?? 2) * k, ground: !!it.fill };
          }
          if (it.circle) {
            const [cx, cy, rad] = it.circle;
            return { ...base, t: "circle", cx: X(cx), cy: Y(cy), r: rad * k, fill: it.fill || !it.stroke ? colour(it.fill, T, T.ink) : undefined, stroke: it.stroke ? colour(it.stroke, T, T.ink) : undefined, sw: (it.width ?? 2) * k };
          }
          if (it.line) {
            return { ...base, t: "path", pts: it.line.map(([x, y]) => [X(x), Y(y)] as [number, number]), stroke: colour(it.stroke, T, T.ink), sw: (it.width ?? 4) * k, prog: 1, head: it.arrow ? "end" : "none" };
          }
          const size = (it.size ?? SIZE.body) * k;
          const font: FontRole = it.bold ? "bold" : "sans";
          const lines = it.text!.split("\n");
          const w = Math.max(...lines.map((l) => ctx.fonts.measure(l, font, size)));
          const h = lines.length * size * 1.3;
          const align = it.align ?? "start";
          const x = X(it.at![0]) - (align === "center" ? w / 2 : align === "end" ? w : 0);
          // at is the text's top-left (or top-centre, top-right) corner
          return { ...base, t: "text", x, y: Y(it.at![1]), w, h, lines, font, size, lh: 1.3, track: 0, color: colour(it.color, T, T.ink), align, need: w };
        });
      },
    };
    if (!s.caption) return pic;
    return { style: { gap: 16, align: "center" }, kids: [pic, textBox(`${s.id}.caption`, s.caption, ctx, { size: SIZE.small, color: T.ink3, align: "center" })] };
  },
});

export const figure = (width: number, height: number, items: FigureItem[], o: { id?: string; caption?: string; enter?: Verb; cue?: number } = {}) => ({ type: "figure" as const, width, height, items, ...o });
export type { FigureItem };
