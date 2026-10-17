// Checks that need no picture: the layout knows every box, so overlaps,
// things off the stage, text spilling out of its card and weak contrast are
// arithmetic. An agent can fix a reel from these without looking at a frame.
// ------------------------------------------------------------------
import type { Insets } from "../canvas/types.ts";
import type { Keyframe } from "./engine.ts";
import { bbox, type Bounds, type Drawable, type RectD } from "./model.ts";
import type { Stage } from "./parts.ts";
import type { Theme } from "./theme.ts";

export type IssueKind = "off-stage" | "overflow" | "overlap" | "contrast" | "widow";
export type Issue = { scene: string; kind: IssueKind; msg: string };

const inter = (a: Bounds, b: Bounds) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 2 && h > 2 ? { w, h } : null;
};
const inside = (a: Bounds, b: Bounds, tol = 1) => a.x >= b.x - tol && a.y >= b.y - tol && a.x + a.w <= b.x + b.w + tol && a.y + a.h <= b.y + b.h + tol;

function lum(hex: string): number | null {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return null;
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
/** The WCAG contrast ratio of two #rrggbb colours (null for any other form). */
export function contrast(a: string, b: string): number | null {
  const [la, lb] = [lum(a), lum(b)];
  if (la === null || lb === null) return null;
  const [x, y] = la > lb ? [la, lb] : [lb, la];
  return (x + 0.05) / (y + 0.05);
}

/** The ground a drawable sits on: the innermost one painted before it that holds its centre. */
function groundOf(ds: Drawable[], i: number): RectD | null {
  const b = bbox(ds[i]!);
  const c = { x: b.x + b.w / 2, y: b.y + b.h / 2, w: 0, h: 0 };
  let best: RectD | null = null;
  for (let j = 0; j < i; j++) {
    const g = ds[j]!;
    if (g.t !== "rect" || !g.ground || g.id === "stage") continue;
    if (inside(c, g, 0) && (!best || g.w * g.h <= best.w * best.h)) best = g;
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

/** The issues of every keyframe, for one stage. */
export function check(ks: Keyframe[], stage: Stage, insets: Insets, theme: Theme): Issue[] {
  const out: Issue[] = [];
  const SAFE = 48;
  const safe = { x: SAFE + insets.left, y: SAFE + insets.top, w: stage.W - SAFE * 2 - insets.left - insets.right, h: stage.H - SAFE * 2 - insets.top - insets.bottom };
  for (const k of ks) {
    const s = k.id;
    const ds = k.ds.filter((d) => d.id !== "stage");
    for (const d of ds) {
      const b = bbox(d);
      if (!inside(b, safe)) out.push({ scene: s, kind: "off-stage", msg: `${d.id} reaches outside the safe area (${box(b)}): use fewer words, set a width, or split the scene` });
      if (d.t !== "text") continue;
      if (d.need > d.w + 1) out.push({ scene: s, kind: "overflow", msg: `${d.id} needs ${Math.round(d.need)} but has ${Math.round(d.w)}: a word too long to break; shorten it, or give it more room (fewer parts beside it)` });
      // One or two characters left alone on the last line of a paragraph.
      const last = d.lines.at(-1) ?? "";
      const lastLen = [...last].length;
      if (d.lines.length > 1 && lastLen > 0 && lastLen <= 2 && !/^\d+$/.test(last)) out.push({ scene: s, kind: "widow", msg: `${d.id} leaves "${last}" alone on its last line: reword it, or change its card's width` });
      const g = groundOf(k.ds, k.ds.indexOf(d));
      if (g && !inside(b, g)) out.push({ scene: s, kind: "overflow", msg: `${d.id} spills out of ${g.id}: use fewer words, or make ${g.id} larger (a card's width, a figure item's rect)` });
      const bg = g?.fill ?? theme.paper;
      const need = d.size >= 40 || (d.size >= 30 && d.font !== "sans") ? 3 : 4.5;
      const c = contrast(d.color, bg);
      if (c !== null && c < need) out.push({ scene: s, kind: "contrast", msg: `${d.id} is ${c.toFixed(2)}:1 on ${bg} (needs ${need}:1): ${tweak(theme, d.color, bg)}` });
    }

    // Overlaps between different parts, each by its outer box.
    const parts = new Map<string, Bounds>();
    for (const d of ds) {
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
  }
  return out;
}
