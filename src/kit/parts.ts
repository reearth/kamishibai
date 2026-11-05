// The parts a keyframe is written with. Each part has an id; a part with the
// same id in the next scene moves there, one that is gone fades out, and a
// new one comes in with its verb. definePart adds a part of your own.
// ------------------------------------------------------------------
import { bbox, type RectD, type Verb } from "./model.ts";
import { intrinsic, layout, type Box, type Paint, type Rect } from "./layout.ts";
import { f, type Fields } from "./fields.ts";
import { MIN_FIT, SIZE, type FontRole, type Theme } from "./theme.ts";
import { lineMarks, parseMarks, type Fonts } from "./text.ts";
import { checkItems, colour, itemPaint, itemSteps, type FigureItem } from "./items.ts";
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
  /** the room under the heading, which a part may size itself to (unset outside a scene's layout) */
  room?: { w: number; h: number };
  /** say something about a part that check may report (a field it can't use here) */
  note?(id: string, msg: string): void;
  fonts: Fonts;
  theme: Theme;
  /** a text file relative to the reel */
  readText(path: string): string;
  /** an image loaded before layout, by its src */
  image(src: string): { img: CanvasImageSource; w: number; h: number } | undefined;
  /** the box of a child part (owned by it, so the checker sees it as one) */
  child(spec: PartSpec, flow?: "row" | "col"): Box;
}

/** A spec with its id filled in, and its enter as the verb alone (its timing is the scene's to keep). */
export type Placed<S> = Omit<S, "enter"> & { id: string; enter?: Verb };

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
  /** ids of things inside it that `focus` may aim at (a figure's items) */
  targets?(spec: Placed<S>): string[];
  /** sentences that things inside it move with later in the scene (a figure's item steps), as [what, sentence], to check */
  stepCues?(spec: S): Array<[string, number]>;
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
  /** stay on one line while no wider than this (breaking only at "\n"), so a row that holds it narrows instead; longer text wraps */
  nowrap?: number;
  /** set smaller, down to this size, until its longest word fits the width it gets */
  shrinkTo?: number;
  /** the colour of runs written between ** (default the theme's accentText) */
  mark?: string;
};

/** A run of text that wraps to the width it gets. */
export function textBox(id: string, written: string, ctx: Ctx, o: TextOpts = {}): Box {
  // Runs written between ** are drawn in the mark's colour; the rest of the layout reads the text without them.
  const { plain: s, marks } = parseMarks(written);
  const font = o.font ?? "sans";
  const size = o.size ?? SIZE.body;
  const lh = o.lh ?? 1.45;
  const track = o.track ?? 0;
  const F = ctx.fonts;
  const oneLine = o.nowrap !== undefined && Math.max(...s.split("\n").map((l) => F.measure(l, font, size, track))) <= o.nowrap;
  const lines = (w: number, sz: number) => (oneLine ? s.split("\n") : o.balance ? F.balance(s, font, sz, w, track) : F.wrap(s, font, sz, w, track));
  const widest = (ls: string[], sz: number) => Math.max(0, ...ls.map((l) => F.measure(l, font, sz, track)));
  // Its longest word (each on a line of its own at no width): text scales with its size, so the size it fits at is a ratio.
  const word = o.shrinkTo !== undefined ? widest(F.wrap(s, font, size, 0, track), size) : 0;
  const sizeAt = (w: number) => (word > w ? Math.max(o.shrinkTo!, (size * w) / word) : size);
  return {
    style: o.style,
    measure: (maxW) => {
      const sz = sizeAt(maxW);
      const ls = lines(maxW, sz);
      return { w: Math.ceil(widest(ls, sz)), h: ls.length * sz * lh };
    },
    paint: (r) => {
      const sz = sizeAt(r.w + 0.5);
      const ls = lines(r.w + 0.5, sz);
      return [
        {
          t: "text", id, x: r.x, y: r.y, w: r.w, h: r.h, lines: ls, font, size: sz, lh, track, color: o.color ?? ctx.theme.ink, align: o.align ?? "start", o: 1, enter: o.enter, need: widest(ls, sz),
          ...(marks.length ? { marks: lineMarks(s, marks, ls), mark: o.mark ?? ctx.theme.accentText } : {}),
        },
      ];
    },
  };
}

export const rect = (id: string, r: Rect, p: Partial<Omit<RectD, "t" | "id" | "owner">>): Paint => ({ t: "rect", id, x: r.x, y: r.y, w: r.w, h: r.h, r: 0, o: 1, ...p }) as Paint;

// ---- the parts --------------------------------------------------------------

export const VERBS = ["fade", "rise", "draw", "type", "count", "pop", "none", "from-left", "from-right", "from-top", "from-bottom", "wipe", "blur"] as const;
/** An enter written out. */
export const ENTER_FIELDS: Fields = {
  type: f.one(VERBS, "the verb (default: the part's own)"),
  ms: f.ms("how long it takes to come in"),
  delay: f.ms("ms from the scene's start (or its cue's sentence) to when it starts coming in"),
};
/** Fields every part takes. */
export const COMMON: Fields = {
  id: f.str("same id in the next scene: the part moves there"),
  enter: f.oneOr(VERBS, ENTER_FIELDS, "how it comes in when it first appears: a verb, or { type?, ms?, delay? } with how long it takes and when it starts"),
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
  doc: 'Plain text. role "display" is a cover\'s title, "lead" is large, "note" is small and grey.',
  fields: {
    text: f.str("the text", true),
    role: f.one(["display", "lead", "body", "note"], 'its size: "display" a cover title, "lead" large, "body" (default), "note" small and grey'),
    align: f.one(["start", "center", "end"], "default start (center for display)"),
    color: f.str("a theme colour's name or CSS (default: by role)"),
    shrink: f.any("set smaller until its longest word fits (a word never breaks): true (down to half its size) or the least share of it, above 0 and up to 1"),
    mark: f.str("the colour of runs written between ** (re·**ceipt**): a theme colour's name or CSS (default accentText)"),
  },
  check: (s, at) => (s.shrink === undefined || typeof s.shrink === "boolean" || (typeof s.shrink === "number" && s.shrink > 0 && s.shrink <= 1) ? [] : [`${at}.shrink: expected true, false or a share above 0 and up to 1, got ${JSON.stringify(s.shrink)}`]),
  box: (s, ctx) => {
    const role = s.role ?? "body";
    const least = (size: number) => (s.shrink === true ? size / 2 : typeof s.shrink === "number" ? size * s.shrink : undefined);
    const mark = s.mark ? colour(s.mark, ctx.theme, ctx.theme.accentText) : undefined;
    if (role === "display") return textBox(s.id, s.text, ctx, { font: "black", size: SIZE.display, lh: 1.1, track: -0.03, align: s.align ?? "center", balance: true, enter: s.enter, color: colour(s.color, ctx.theme, ctx.theme.ink), shrinkTo: least(SIZE.display), mark });
    const size = role === "lead" ? SIZE.h2 : role === "note" ? SIZE.small : SIZE.body;
    return textBox(s.id, s.text, ctx, {
      shrinkTo: least(size),
      mark,
      font: role === "lead" ? "bold" : "sans",
      size,
      color: colour(s.color, ctx.theme, role === "note" ? ctx.theme.ink3 : ctx.theme.ink),
      enter: s.enter,
      align: s.align,
      balance: s.align === "center" || s.align === "end",
    });
  },
});

const groupFields: Fields = {
  parts: f.parts("the parts in it", true),
  gap: f.num("space between them"),
  align: f.one(["start", "center", "end", "stretch"], "how the parts line up across it (default: center in a row, stretch in a col)"),
  narrow: f.one(["stack", "wrap", "fit", "keep"], 'a row that does not fit across: "stack" into a column (default), "wrap" like tiles, "fit" (stays a row on a wide stage, the scene shrunk to fit it; stacks on a tall one), or "keep"'),
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
  // "fit" keeps the row whole for the scene to shrink, on a wide stage, when that shrinks it less than
  // stacking it would have to (by the room under the heading).
  const rowBetter = () => {
    if (isTall(ctx.stage)) return false;
    const kRow = room / intrinsic({ style: { dir: "row", gap }, kids: s.parts.map((p) => ctx.child(p, "row")) }).w;
    const colH = layout({ style: { w: room }, kids: [{ style: { dir: "col", gap: Math.min(gap, 28), align: "center" }, kids: s.parts.map((p) => ctx.child(p, "col")) }] }, room, Infinity).reduce((h, d) => Math.max(h, bbox(d).y + bbox(d).h), 0);
    const kCol = Math.min(1, (ctx.room?.h ?? ctx.stage.H) / Math.max(1, colH));
    return kRow >= MIN_FIT && kRow > kCol;
  };
  const narrow = dir === "row" && narrowAs !== "keep" && !fits() ? (narrowAs === "fit" ? (rowBetter() ? "fit" : "stack") : narrowAs) : null;
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
      ...(narrow && narrow !== "fit" ? { self: "stretch" as const } : {}),
      ...(narrow === "wrap" ? { wrap: true, align: "start" as const } : {}),
    },
    kids: s.parts.map((p) => {
      const b = ctx.child(p, d);
      // In a row the parts narrow to fit, but for one kept whole for the scene to shrink.
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

function codeBlock(id: string, ref: string, highlight: string | undefined, ctx: Ctx): Box {
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
                const at = highlight ? l.indexOf(highlight) : -1;
                if (at >= 0) {
                  const x0 = r.x + gutter + F.measure(l.slice(0, at), "mono", size);
                  out.push(rect(`${id}.mark`, { x: x0 - 6, y: y + 4, w: F.measure(highlight!, "mono", size) + 12, h: size * lh - 8 }, { fill: T.accentTint, r: 6, enter: "pop" }));
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
    code: f.str('code as text, or "path#L44" (lines 43–45) / "path#L40-L48" read next to the reel'),
    highlight: f.str("a substring of the code to highlight"),
    tone: f.one(["plain", "accent", "dim"], '"accent" outlines it in the accent, "dim" greys it (default "plain")'),
    width: f.num("its width in layout units (at least 360); a column on a tall stage gives it the full width instead"),
  },
  box: (s, ctx) => {
    const T = ctx.theme;
    const tone = s.tone ?? "plain";
    const full = isTall(ctx.stage) && ctx.flow !== "row";
    if (full && s.width !== undefined) ctx.note?.(s.id, `${s.id}'s width (${s.width}) goes unused: on a tall stage a card in a column takes the full width. Drop it, or put the card in a row`);
    return {
      // In a column on a tall stage a card takes the full width instead of its own.
      style: { pad: 44, gap: 20, shrink: 0, minW: 360, ...(full ? { self: "stretch" as const } : { w: s.width }) },
      paint: (r) => [
        rect(s.id, r, { fill: tone === "dim" ? T.well : T.card, stroke: tone === "accent" ? T.accent : T.rule, sw: tone === "accent" ? 4 : 2, r: 20, ground: true, enter: s.enter }),
      ],
      kids: [
        // Balanced, so a narrow card never leaves its last word alone.
        ...(s.label ? [textBox(`${s.id}.label`, s.label, ctx, { font: "bold", size: SIZE.small, color: tone === "accent" ? T.accentText : tone === "dim" ? T.ink2 : T.ink3, balance: true })] : []),
        ...(s.body ? [textBox(`${s.id}.body`, s.body, ctx, { font: "bold", size: SIZE.h2 - 4, lh: 1.35, color: tone === "dim" ? T.ink3 : T.ink, balance: true })] : []),
        ...(s.code ? [codeBlock(`${s.id}.code`, s.code, s.highlight, ctx)] : []),
      ],
    };
  },
});

definePart<ArrowSpec>("arrow", {
  doc: 'An arrow between parts in a row (it turns down in a column), or "versus" (≠) / "equals" (=) between two to compare.',
  fields: { kind: f.one(["right", "down", "versus", "equals"], 'default "right"; in a column a right arrow turns down') },
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
  fields: { text: f.str("the label", true), state: f.one(["active", "done"], '"active" filled with the accent, "done" greyed and ticked'), n: f.num("a number in a badge before the label (a tick once done)") },
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
      kids: [...badge, textBox(`${s.id}.t`, s.text, ctx, {
        font: "bold",
        size: SIZE.body,
        color: on ? T.onAccent : done ? T.ink2 : T.ink,
        // A label on one line while it fits across the room inside the pill; a sentence wraps, evenly.
        nowrap: ctx.stage.W - ctx.frame.left - ctx.frame.right - 2 * (badge.length ? 32 : 40) - (badge.length ? d + 16 : 0),
        balance: true,
      })],
    };
  },
});

definePart<StatSpec>("stat", {
  doc: "A big number that counts up from its previous value (or 0).",
  fields: { value: f.num("the number", true), prefix: f.str("set small before the number ($, ¥, ~)"), unit: f.str("set small after the number"), label: f.str("a line under it"), tone: f.one(["plain", "accent"], '"accent" sets the number in the accent'), digits: f.num("decimals shown (default: as many as the value has)") },
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
            ...(s.prefix ? [textBox(`${s.id}.p`, s.prefix, ctx, { font: "bold", size: SIZE.h2, lh: 1.6, color: T.ink2 })] : []),
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
  doc: "A bulleted list; at picks one item to stress. Each item keeps its own id, so an item still there slides.",
  fields: { items: f.strs("the items", true), at: f.num("the index of the item to stress"), numbered: f.bool("number the items (1, 2, …) instead of bullets") },
  box: (s, ctx) => {
    const T = ctx.theme;
    // Numbers all as wide as the widest, so the items line up.
    const numW = s.numbered ? Math.ceil(ctx.fonts.measure(`${s.items.length}.`, "bold", SIZE.body)) : 18;
    return {
      style: { gap: 28 },
      kids: s.items.map((item, i) => ({
        style: { dir: "row", gap: 24, align: "start" },
        kids: [
          s.numbered
            ? textBox(`${s.id}.${i}.n`, `${i + 1}.`, ctx, { font: "bold", size: SIZE.body, color: s.at === i ? T.accentText : T.ink3, align: "end", nowrap: Infinity, style: { w: numW, shrink: 0 } })
            : {
                style: { w: 18, h: SIZE.body * 1.45, shrink: 0 },
                paint: (r) => [{ t: "circle", id: `${s.id}.${i}.dot`, cx: r.x + 9, cy: r.y + r.h / 2, r: 9, fill: s.at === i ? T.accent : T.ink, o: 1 } as Paint],
              },
          textBox(`${s.id}.${i}`, item, ctx, { font: s.at === i ? "bold" : "sans", size: SIZE.body, color: s.at === undefined || s.at === i ? T.ink : T.ink3, style: { shrink: 1 } }),
        ],
      })),
    };
  },
});

definePart<ImageSpec>("image", {
  doc: "A picture from a file next to the reel, as large as the room it gets allows (its shape kept).",
  fields: {
    src: f.str("a path relative to the reel", true),
    width: f.num("at most this wide, in layout units (default: as wide as the room allows)"),
    height: f.num("at most this tall (default: the room under the heading, less the caption)"),
    upscale: f.bool("false: never wider than the file's own pixels, so a small picture stays sharp (default true)"),
    caption: f.str("a small line under it"),
  },
  images: (s) => [s.src],
  box: (s, ctx) => {
    const im = ctx.image(s.src);
    const ratio = im && im.w > 0 ? im.h / im.w : 0.5625;
    const captionH = s.caption ? SIZE.small * 1.45 + 16 : 0;
    const maxH = s.height ?? (ctx.room ? ctx.room.h - captionH : ctx.stage.H * 0.5);
    const most = Math.min(s.width ?? Infinity, s.upscale === false && im?.w ? im.w : Infinity);
    const pic: Box = {
      measure: (maxW) => {
        let w = Math.min(maxW, most);
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

type FigureSpec = { id: string; type: "figure"; width: number; height: number; items: FigureItem[]; caption?: string };

const itemId = (s: { id: string }, it: FigureItem, i: number) => `${s.id}.${it.id ?? i}`;

definePart<FigureSpec>("figure", {
  doc: "A drawing as data: rects, circles, lines and text in its own width × height units, fitted to the room it gets. Each item may have an id (the same id in the next scene moves it) and a cue.",
  fields: {
    width: f.num("its units across", true),
    height: f.num("its units down", true),
    items: f.list('{ rect: [x, y, w, h] } | { circle: [cx, cy, r] } | { line: [[x, y], …], arrow? } (with fill: a closed, filled shape) | { text, pos: [x, y], size?, font? (sans|bold|black|mono), width? (wraps there), align? }, with fill, stroke, lineWidth, r, color (a theme colour name or CSS), opacity, dash: [on, off], id, enter, cue, then: [{ cue?, delay?, ms?, …the fields that change }]. pos is the top-left of a text (top-centre with align: center); size defaults to 44', true),
    caption: f.str("a small line under it"),
  },
  check: (s, at) => checkItems(s.items, `${at}.items`, ["cue"]),
  cues: (s) => (Array.isArray(s.items) ? s.items.flatMap((it, i) => (typeof it?.cue === "number" ? [[itemId(s, it, i), it.cue] as [string, number]] : [])) : []),
  stepCues: (s) => (Array.isArray(s.items) ? s.items.flatMap((it, i) => (Array.isArray(it?.then) ? it.then.flatMap((st) => (typeof st?.cue === "number" ? [[itemId(s, it, i), st.cue] as [string, number]] : [])) : [])) : []),
  targets: (s) => (Array.isArray(s.items) ? s.items.flatMap((it, i) => (typeof it?.id === "string" ? [itemId(s, it, i)] : [])) : []),
  box: (s, ctx) => {
    const T = ctx.theme;
    // As tall as the room under the heading allows, less its caption (outside a scene's layout, 60% of the stage).
    const maxH = ctx.room ? ctx.room.h - (s.caption ? SIZE.small * 1.45 + 16 : 0) : ctx.stage.H * 0.6;
    const pic: Box = {
      style: { shrink: 1 },
      measure: (maxW) => {
        let w = Math.min(maxW, s.width);
        if ((w * s.height) / s.width > maxH) w = (maxH * s.width) / s.height;
        return { w, h: (w * s.height) / s.width };
      },
      paint: (r) => {
        const k = r.w / s.width;
        // An item with a cue comes in on its own turn; the rest with the figure.
        return s.items.map((it, i) => {
          const base = { id: itemId(s, it, i), ...(it.cue ? { turn: itemId(s, it, i) } : {}), o: 1, enter: it.enter };
          const place = { x: r.x, y: r.y, k };
          const d = itemPaint(it, base, place, T, ctx.fonts);
          return it.then ? ({ ...d, steps: itemSteps(it, base, place, T, ctx.fonts) } as Paint) : d;
        });
      },
    };
    if (!s.caption) return pic;
    return { style: { gap: 16, align: "center" }, kids: [pic, textBox(`${s.id}.caption`, s.caption, ctx, { size: SIZE.small, color: T.ink3, align: "center" })] };
  },
});

export const figure = (width: number, height: number, items: FigureItem[], o: { id?: string; caption?: string; enter?: Verb; cue?: number } = {}) => ({ type: "figure" as const, width, height, items, ...o });
export type { FigureItem };
