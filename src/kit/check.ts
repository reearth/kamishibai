// Checks that need no picture: the layout knows every box, so overlaps,
// things off the stage, text spilling out of its card and weak contrast are
// arithmetic. An agent can fix a reel from these without looking at a frame.
// ------------------------------------------------------------------
import type { Context2D, Insets } from "../canvas/types.ts";
import { parseColour } from "./colour.ts";
import { enteredMs, MORPH_MS, stepAt, type Keyframe } from "./engine.ts";
import { bbox, type Bounds, type Drawable, type RectD } from "./model.ts";
import type { Stage } from "./parts.ts";
import { familyOf, type Fonts } from "./text.ts";
import type { FontRole, Theme } from "./theme.ts";

export type IssueKind = "off-stage" | "overflow" | "overlap" | "contrast" | "widow" | "glyph" | "unused" | "timing";
export type Issue = { scene: string; kind: IssueKind; msg: string };

const inter = (a: Bounds, b: Bounds) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 2 && h > 2 ? { w, h } : null;
};
const inside = (a: Bounds, b: Bounds, tol = 1) => a.x >= b.x - tol && a.y >= b.y - tol && a.x + a.w <= b.x + b.w + tol && a.y + a.h <= b.y + b.h + tol;

function lum(colour: string): number | null {
  const p = parseColour(colour);
  // A see-through colour's contrast depends on what is under it: not judged.
  if (!p || p[3] < 1) return null;
  const c = p.slice(0, 3).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
/**
 * The last line of a paragraph left alone: one or two characters, or one
 * latin word under a line of several more than twice its length (a short
 * phrase broken in two, "Count grapheme / clusters", is not). A line that is
 * only a number is not.
 */
export function widow(lines: string[]): string | null {
  const last = lines.at(-1) ?? "";
  const len = [...last].length;
  if (lines.length < 2 || len === 0 || /^\d+$/.test(last)) return null;
  const prev = lines.at(-2) ?? "";
  const loneWord = /^[\p{Script=Latin}\d'’.,!?:;)-]+$/u.test(last) && / /.test(prev) && len * 2.5 < [...prev].length;
  return len <= 2 || loneWord ? last : null;
}

/** The WCAG contrast ratio of two opaque colours in a form parseColour reads (null otherwise). */
export function contrast(a: string, b: string): number | null {
  const [la, lb] = [lum(a), lum(b)];
  if (la === null || lb === null) return null;
  const [x, y] = la > lb ? [la, lb] : [lb, la];
  return (x + 0.05) / (y + 0.05);
}

/** What a text sits on: its id and colour, its size (the innermost wins), and its box when it is a rect (a card), which the text must stay inside. */
type Ground = { id: string; fill: string; area: number; rect?: RectD };

/** Whether (x, y) is inside the polygon `pts` (even-odd). */
function inPolygon(x: number, y: number, pts: [number, number][]): boolean {
  let hit = false;
  for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) {
    const [xa, ya] = pts[a]!;
    const [xb, yb] = pts[b]!;
    if (ya > y !== yb > y && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) hit = !hit;
  }
  return hit;
}

/**
 * The ground a drawable sits on: the innermost one painted before it that
 * holds its centre. A card or a filled rect, and a filled circle or closed
 * shape (a disc under a mark), not the paper.
 */
function groundOf(ds: Drawable[], i: number): Ground | null {
  const b = bbox(ds[i]!);
  const [x, y] = [b.x + b.w / 2, b.y + b.h / 2];
  let best: Ground | null = null;
  const take = (g: Ground) => void ((!best || g.area <= best.area) && (best = g));
  for (let j = 0; j < i; j++) {
    const g = ds[j]!;
    if (g.id === "stage") continue;
    if (g.t === "rect" && g.ground && inside({ x, y, w: 0, h: 0 }, g, 0)) take({ id: g.id, fill: g.fill ?? "", area: g.w * g.h, rect: g });
    else if (g.t === "circle" && g.fill && (x - g.cx) ** 2 + (y - g.cy) ** 2 <= g.r ** 2) take({ id: g.id, fill: g.fill, area: Math.PI * g.r ** 2 });
    else if (g.t === "path" && g.fill && g.pts.length >= 3 && inPolygon(x, y, g.pts)) {
      const gb = bbox(g);
      take({ id: g.id, fill: g.fill, area: gb.w * gb.h });
    }
  }
  return best;
}

/** Which theme keys to change for a contrast that is too weak. */
function tweak(theme: Theme, fg: string, bg: string): string {
  const keys = (c: string) => Object.entries(theme).filter(([, v]) => typeof v === "string" && v.toLowerCase() === c.toLowerCase()).map(([k]) => `theme.${k}`);
  const [f, b] = [keys(fg), keys(bg)];
  if (!f.length && !b.length) return "use a colour further from the background";
  return `move ${[...f, ...b].join(" or ")} further apart`;
}

const box = (b: Bounds) => `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}×${Math.round(b.h)}`;

/** How long a scene shows all its parts at least, before check says it ends too soon after they are in: half a second, or half a shorter scene. */
const WHOLE_MS = 500;

/** The issues of every keyframe, for one stage, kept `margin` in from its edges (or a scene's own margin, where less). */
export function check(ks: Keyframe[], stage: Stage, insets: Insets, theme: Theme, margin = 48): Issue[] {
  const out: Issue[] = [];
  ks.forEach((k, ki) => {
    const s = k.id;
    // Parts still coming in until the scene is nearly over: it is gone before they are seen whole.
    if (isFinite(k.ms) && k.ms > 0) {
      const e = enteredMs(ks, ki);
      const whole = Math.max(0, k.ms - e);
      if (whole < Math.min(WHOLE_MS, k.ms / 2)) {
        out.push({ scene: s, kind: "timing", msg: `its parts are all in for only ${(whole / 1000).toFixed(2)} s of its ${(k.ms / 1000).toFixed(2)} s (they take ${(e / 1000).toFixed(2)} s to come in): bring them in sooner or quicker (enter: { delay, ms }), or hold the scene longer` });
      }
    }
    // A scene that chose a smaller margin is held to that, not to the default safe area.
    const e = (side: keyof Insets) => Math.min(margin, k.margin?.[side] ?? margin);
    const safe = { x: e("left") + insets.left, y: e("top") + insets.top, w: stage.W - e("left") - e("right") - insets.left - insets.right, h: stage.H - e("top") - e("bottom") - insets.top - insets.bottom };
    const ds = k.ds.filter((d) => d.id !== "stage");
    // The scene as it stands when it comes in, and after each step has settled:
    // each text is judged against what it sits on at that moment.
    const ends = [...new Set(ds.flatMap((d) => d.steps?.map((st) => (st.at ?? 0) + (st.ms ?? MORPH_MS)) ?? []))].sort((a, b) => a - b);
    const moments = [ds, ...ends.map((t) => ds.map((d) => stepAt(d, t)))];
    const forms = moments.flat();
    const said = new Set<string>();
    const say = (i: Issue) => {
      if (!said.has(i.msg)) out.push(i);
      said.add(i.msg);
    };
    for (const now of moments) {
      for (let i = 0; i < now.length; i++) {
        const d = now[i]!;
        const b = bbox(d);
        if (!inside(b, safe)) say({ scene: s, kind: "off-stage", msg: `${d.id} reaches outside the safe area (${box(b)}): use fewer words, set a width, or split the scene` });
        if (d.t !== "text") continue;
        if (d.need > d.w + 1) say({ scene: s, kind: "overflow", msg: `${d.id} needs ${Math.round(d.need)} but has ${Math.round(d.w)}: a word too long to break; shorten it, or give it more room (fewer parts beside it)` });
        const last = widow(d.lines);
        if (last) say({ scene: s, kind: "widow", msg: `${d.id} leaves "${last}" alone on its last line: reword it, or change its card's width` });
        const g = groundOf(now, i);
        if (g?.rect && !inside(b, g.rect)) say({ scene: s, kind: "overflow", msg: `${d.id} spills out of ${g.id}: use fewer words, or make ${g.id} larger (a card's width, a figure item's rect)` });
        const bg = g?.fill || theme.paper;
        const need = d.size >= 40 || (d.size >= 30 && d.font !== "sans") ? 3 : 4.5;
        const c = contrast(d.color, bg);
        if (c !== null && c < need) say({ scene: s, kind: "contrast", msg: `${d.id} is ${c.toFixed(2)}:1 on ${bg} (needs ${need}:1): ${tweak(theme, d.color, bg)}` });
        // Its marked runs, in their own colour.
        if (d.mark && d.marks?.some((l) => l.length)) {
          const cm = contrast(d.mark, bg);
          if (cm !== null && cm < need) say({ scene: s, kind: "contrast", msg: `${d.id}'s marked text is ${cm.toFixed(2)}:1 on ${bg} (needs ${need}:1): ${tweak(theme, d.mark, bg)}` });
        }
      }
    }

    // Overlaps between different parts, each by its outer box.
    const parts = new Map<string, Bounds>();
    for (const d of forms) {
      const b = bbox(d);
      const p = parts.get(d.owner);
      if (!p) parts.set(d.owner, b);
      else {
        const x = Math.min(p.x, b.x);
        const y = Math.min(p.y, b.y);
        parts.set(d.owner, { x, y, w: Math.max(p.x + p.w, b.x + b.w) - x, h: Math.max(p.y + p.h, b.y + b.h) - y });
      }
    }
    const names = [...parts.keys()];
    for (let a = 0; a < names.length; a++)
      for (let b = a + 1; b < names.length; b++) {
        const hit = inter(parts.get(names[a]!)!, parts.get(names[b]!)!);
        if (hit) out.push({ scene: s, kind: "overlap", msg: `${names[a]} and ${names[b]} overlap by ${Math.round(hit.w)}×${Math.round(hit.h)}: put them in one row or col, or move one to another scene` });
      }
  });
  return out;
}

/**
 * Characters no font has, which draw as an empty box: each is drawn on `g`
 * (64 × 64 or larger) and compared with a code point no font has. `texts`
 * are the strings drawn, each with its font, the scene and what draws it.
 */
export function missingGlyphs(texts: Array<{ s: string; font: FontRole; scene: string; id: string }>, fonts: Fonts, g: Context2D): Issue[] {
  const draw = (ch: string, font: FontRole) => {
    g.clearRect(0, 0, 64, 64);
    g.font = fonts.css(font, 48);
    g.letterSpacing = "0px";
    g.textBaseline = "alphabetic";
    g.fillStyle = "#000";
    g.fillText(ch, 4, 50);
    return g.getImageData(0, 0, 64, 64).data.join();
  };
  const box = new Map<FontRole, string>();
  const seen = new Set<string>();
  const out: Issue[] = [];
  for (const t of texts) {
    for (const ch of new Set(t.s)) {
      // Once per family: the weights of one family have the same characters.
      const key = `${familyOf(fonts.theme, t.font)}|${ch}`;
      if (/\s/u.test(ch) || seen.has(key)) continue;
      seen.add(key);
      if (!box.has(t.font)) box.set(t.font, draw("\u{10FFFD}", t.font));
      if (draw(ch, t.font) !== box.get(t.font)) continue;
      const code = `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;
      out.push({ scene: t.scene, kind: "glyph", msg: `${t.id} draws "${ch}" (${code}), which no font has: it shows as an empty box. Use another character, or add a font that has it` });
    }
  }
  return out;
}
