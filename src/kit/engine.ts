// Keyframes in, the drawables on screen at a time out, the way Keynote's
// Magic Move goes from one slide to the next: a drawable with the same id
// moves (place, size, colour, path points), one that is gone fades out, and
// a new one comes in with its verb. Layout runs once per scene and view;
// playback only interpolates.
// ------------------------------------------------------------------
import { bezier, eases } from "../easing.ts";
import type { Drawable, ImageD, PaintD, PathD, TextD } from "./model.ts";

export type Keyframe = { id: string; start: number; ms: number; ds: Drawable[] };

/** A drawable as it is at one moment: maybe lifted, scaled, and (painted) on the reel's clock. */
export type Live = Drawable & { dy?: number; sc?: number; now?: number };

/** A part that stays moves to its new place over this long. */
export const MORPH_MS = 750;
/** A part that leaves fades out over this long. */
const EXIT_MS = 320;
const move = bezier(0.65, 0, 0.35, 1);
const clamp01 = (p: number) => (p < 0 ? 0 : p > 1 ? 1 : p);
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
const HEX = /^#[0-9a-f]{6}$/i;

function lerpColor(a: string, b: string, p: number): string {
  if (a === b || !HEX.test(a) || !HEX.test(b)) return p < 0.5 ? a : b;
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return "#" + pa.map((v, i) => Math.round(lerp(v, pb[i]!, p)).toString(16).padStart(2, "0")).join("");
}

const num = (d: TextD) => (/^-?[\d,]+(\.\d+)?$/.test(d.lines.join("")) ? Number(d.lines.join("").replace(/,/g, "")) : null);

/** Same id and the same shape of data: it moves. Anything else crossfades. */
function morphable(a: Drawable, b: Drawable): boolean {
  if (a.t !== b.t) return false;
  if (a.t === "text") {
    const t = b as TextD;
    return (a.lines.join("\n") === t.lines.join("\n") && a.font === t.font) || (t.enter === "count" && num(a) !== null && num(t) !== null);
  }
  if (a.t === "path") return a.pts.length === (b as PathD).pts.length && a.head === (b as PathD).head;
  if (a.t === "paint") return a.key === (b as PaintD).key;
  if (a.t === "image") return a.src === (b as ImageD).src;
  return true;
}

function fmtLike(sample: string, v: number): string {
  const digits = sample.split(".")[1]?.length ?? 0;
  return v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function tween(a: Drawable, b: Drawable, p: number): Live {
  const out: Record<string, unknown> = { ...b };
  for (const k of Object.keys(b)) {
    const va = (a as Record<string, unknown>)[k];
    const vb = (b as Record<string, unknown>)[k];
    if (typeof va === "number" && typeof vb === "number") out[k] = lerp(va, vb, p);
    else if (typeof va === "string" && typeof vb === "string" && va.startsWith("#") && vb.startsWith("#")) out[k] = lerpColor(va, vb, p);
  }
  if (a.t === "path" && b.t === "path") out.pts = b.pts.map((q, i) => [lerp(a.pts[i]![0], q[0], p), lerp(a.pts[i]![1], q[1], p)]);
  if (a.t === "text" && b.t === "text" && b.enter === "count") {
    const [na, nb] = [num(a)!, num(b)!];
    if (na !== nb) out.lines = [fmtLike(b.lines.join(""), lerp(na, nb, eases.smooth(p)))];
  }
  return out as Live;
}

/** A part coming in for the first time, `e` ms after its turn began. */
function enter(d: Drawable, e: number): Live | null {
  if (e < 0) return null;
  const verb = d.enter ?? (d.t === "path" ? "draw" : "rise");
  switch (verb) {
    case "none":
      return d;
    case "fade":
      return { ...d, o: d.o * clamp01(e / 400) };
    case "rise": {
      const p = eases.smooth(clamp01(e / 550));
      return { ...d, o: d.o * clamp01(e / 300), dy: (1 - p) * 24 };
    }
    case "pop": {
      const p = eases.pop(clamp01(e / 450));
      return { ...d, o: d.o * clamp01(e / 150), sc: 0.6 + 0.4 * p };
    }
    case "draw":
      if (d.t === "path") return { ...d, prog: eases.inOut(clamp01(e / 650)) };
      return { ...d, o: d.o * clamp01(e / 400) };
    case "type": {
      if (d.t !== "text") return { ...d, o: d.o * clamp01(e / 400) };
      const n = [...d.lines.join("")].length;
      const per = Math.min(38, 1400 / Math.max(1, n));
      return { ...d, chars: Math.min(n, Math.floor(e / per)) };
    }
    case "count": {
      if (d.t !== "text" || num(d) === null) return { ...d, o: d.o * clamp01(e / 400) };
      return { ...d, lines: [fmtLike(d.lines.join(""), num(d)! * eases.smooth(clamp01(e / 1100)))] };
    }
  }
}

/** The keyframe on screen at `t`. */
export function keyframeAt(ks: Keyframe[], t: number): number {
  const i = ks.findIndex((k) => t < k.start + k.ms);
  return i < 0 ? ks.length - 1 : i;
}

/** How long after a scene starts its last part has come in (its frames repeat after). */
export function settleMs(ks: Keyframe[], i: number): number {
  const k = ks[i]!;
  const prev = i > 0 ? ks[i - 1]! : null;
  const before = new Set(prev?.ds.map((d) => d.id));
  const owners = new Set<string>();
  let fresh = 0;
  for (const d of k.ds) if (!before.has(d.id)) owners.add(d.owner), fresh++;
  const base = prev ? MORPH_MS * 0.55 : 150;
  // the last newcomer's delay, plus the longest verb (a count, or typing)
  return Math.max(MORPH_MS, base + owners.size * 160 + Math.min(fresh, 12) * 35 + 1500);
}

/** Everything on screen at time `t`, in paint order. */
export function frameAt(ks: Keyframe[], t: number): Live[] {
  const i = keyframeAt(ks, t);
  const k = ks[i]!;
  const prev = i > 0 ? ks[i - 1]! : null;
  const tau = t - k.start;
  const before = new Map(prev?.ds.map((d) => [d.id, d]));
  const now = new Set(k.ds.map((d) => d.id));
  const p = move(clamp01(tau / MORPH_MS));

  // New parts come in one owner at a time, after the movers have mostly settled.
  const owners: string[] = [];
  for (const d of k.ds) if (!before.has(d.id) && !owners.includes(d.owner)) owners.push(d.owner);
  const base = prev ? MORPH_MS * 0.55 : 150;
  const seen = new Map<string, number>();

  const out: Live[] = [];
  const exiting: Live[] = [];
  for (const d of prev?.ds ?? []) {
    if (now.has(d.id)) continue;
    exiting.push({ ...d, o: d.o * (1 - clamp01(tau / EXIT_MS)) });
  }
  for (const d of k.ds) {
    const a = before.get(d.id);
    if (a && morphable(a, d)) {
      out.push(tween(a, d, p));
    } else if (a) {
      // Changed content under the same id: the old one fades as both move.
      const ghost = tween(d, a, 1 - p);
      const fading = { ...ghost, id: d.id + "~", o: ghost.o * (1 - clamp01(tau / (MORPH_MS * 0.6))) } as Live;
      if (d.t === "paint" || d.t === "image") {
        // An opaque box: show the new one whole underneath and dissolve the
        // old one off the top, so the paper never shows through.
        out.push({ ...tween(a, d, p), ...(d.t === "paint" ? { key: d.key, fn: d.fn } : { src: d.src }) } as Live, fading);
      } else {
        out.push(fading);
        // Verbs are for first appearances; changed content just fades in (a number still counts).
        const fresh = enter({ ...d, enter: d.enter === "count" ? "count" : "fade" }, tau - MORPH_MS * 0.3);
        if (fresh) out.push(fresh);
      }
    } else {
      const n = seen.get(d.owner) ?? 0;
      seen.set(d.owner, n + 1);
      const delay = base + owners.indexOf(d.owner) * 160 + Math.min(n, 12) * 35;
      const e = enter(d, tau - delay);
      if (e) out.push(e);
    }
  }
  // Leaving parts sit just above the paper, under everything that stays.
  const all = out.length ? [out[0]!, ...exiting, ...out.slice(1)] : exiting;
  // A painted part draws itself from the reel's clock, so it changes every frame.
  return all.map((d) => (d.t === "paint" ? { ...d, now: t } : d));
}
