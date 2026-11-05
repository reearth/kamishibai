// Colours as the kit compares and blends them. A reel may write any CSS
// colour (#fff, rgb(), a name); the host's canvas turns each into #rrggbb, or
// rgba() for one with alpha, before the engine and the checker see it.
// ------------------------------------------------------------------
import type { Context2D } from "../canvas/types.ts";
import type { Drawable } from "./model.ts";
import type { Theme } from "./theme.ts";

export type RGBA = [number, number, number, number];

/** #rgb, #rgba, #rrggbb, #rrggbbaa, rgb() or rgba(), as 0–255 channels and 0–1 alpha; null for anything else. */
export function parseColour(c: string): RGBA | null {
  const s = c.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (m) {
    const h = m[1]!.length <= 4 ? [...m[1]!].map((x) => x + x).join("") : m[1]!;
    const n = [0, 2, 4, 6].map((i) => (i < h.length ? parseInt(h.slice(i, i + 2), 16) : 255));
    return [n[0]!, n[1]!, n[2]!, n[3]! / 255];
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(s);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return [+m[1]!, +m[2]!, +m[3]!, a];
  }
  return null;
}

export function formatColour([r, g, b, a]: RGBA): string {
  const hex = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
  return a >= 1 ? `#${hex(r)}${hex(g)}${hex(b)}` : `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${+a.toFixed(3)})`;
}

/**
 * A colour in the form parseColour reads. A name or another CSS form is
 * painted on one pixel of `g` and read back (a canvas does not always say
 * what it parsed); one the canvas does not take is left as given.
 */
export function normalColour(c: string, g: Context2D): string {
  const p = parseColour(c);
  if (p) return formatColour(p);
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, 1, 1);
  g.fillStyle = "rgba(0, 0, 0, 0)";
  g.fillStyle = c;
  g.fillRect(0, 0, 1, 1);
  const [r, gr, b, a] = g.getImageData(0, 0, 1, 1).data;
  g.restore();
  // Nothing painted: the canvas did not take it.
  return a === 0 ? c : formatColour([r!, gr!, b!, a! / 255]);
}

/** The theme with every colour normal (fonts and weights untouched). */
export function normalTheme(t: Theme, g: Context2D): Theme {
  const out: Record<string, unknown> = { ...t };
  for (const [k, v] of Object.entries(t)) if (typeof v === "string") out[k] = normalColour(v, g);
  return out as unknown as Theme;
}

/** Drawables (and their steps) with every colour normal. */
export function normalColours(ds: Drawable[], g: Context2D): Drawable[] {
  const one = (d: Drawable): Drawable => {
    const out: Record<string, unknown> = { ...d };
    for (const k of ["fill", "stroke", "color", "mark"]) if (typeof out[k] === "string") out[k] = normalColour(out[k] as string, g);
    if (d.steps) out.steps = d.steps.map((s) => ({ ...s, d: one(s.d) }));
    return out as Drawable;
  };
  return ds.map(one);
}
