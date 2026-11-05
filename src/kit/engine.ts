// Keyframes in, the drawables on screen at a time out, the way Keynote's
// Magic Move goes from one slide to the next: a drawable with the same id
// moves (place, size, colour, path points), one that is gone fades out, and
// a new one comes in with its verb. A scene can come in another way instead
// (a cut, a fade, a push or a wipe), and a camera can move in on a part.
// Layout runs once per scene and view; playback only interpolates.
// ------------------------------------------------------------------
import { bezier, eases } from "../easing.ts";
import { formatColour, parseColour, type RGBA } from "./colour.ts";
import { VERB_MS, type Drawable, type ImageD, type PaintD, type PathD, type TextD } from "./model.ts";
import type { SceneEnter, Transition } from "./spec.ts";

/** The camera: the stage point shown at the view's anchor (its frame's centre), and the zoom. */
export type Cam = { x: number; y: number; s: number };
/** The camera moves to `cam` at `at` ms from the scene's start. */
export type Shot = { at: number; cam: Cam };

export type Keyframe = {
  id: string;
  start: number;
  ms: number;
  ds: Drawable[];
  /** when a part (by owner) comes in, in ms from the scene's start, if not with the scene */
  cues?: Record<string, number>;
  /** how it comes in after the keyframe before (default "morph") */
  transition?: Transition;
  /** how long the transition takes (default: its own, MORPH_MS, FADE_MS or TRANS_MS) */
  transMs?: number;
  /** when its new parts come in, unless a part says: delay before the first, how long each takes, ms between them */
  enter?: SceneEnter;
  /** a part's own delay and length, by owner (or turn) */
  enters?: Record<string, { delay?: number; ms?: number }>;
  /** where the camera goes, in order; the first is at 0. None: the camera stays home. */
  shots?: Shot[];
};

/**
 * A drawable as it is at one moment: maybe moved, scaled, revealed in part
 * from the left, blurred, and (painted) on the reel's clock.
 */
export type Live = Drawable & { dx?: number; dy?: number; sc?: number; reveal?: number; blur?: number; now?: number };

/** One picture of the scene to paint, under a camera; a transition paints two. */
export type Layer = {
  ds: Live[];
  cam?: Cam;
  /** opacity of the whole layer */
  o?: number;
  /** moved across, in stage units, outside the camera */
  dx?: number;
  /** only the part of the stage left of this x shows */
  clipW?: number;
};

/** A part that stays moves to its new place over this long. */
export const MORPH_MS = 750;
/** A part that leaves fades out over this long. */
const EXIT_MS = 320;
/** The camera moves over this long. */
export const CAM_MS = 900;
/** A push or a wipe takes this long; a fade spends this long going out. */
const TRANS_MS = 700;
const FADE_MS = 400;
/** New parts coming in together start this far apart, by default. */
const STAGGER_MS = 160;

/** How long what stays takes to move into keyframe `k` (a morph). */
const moveMs = (k: Keyframe) => k.transMs ?? MORPH_MS;
/** How long the scene before stays on screen as `k` comes in. */
export function outMs(k: Keyframe): number {
  switch (k.transition ?? "morph") {
    case "morph":
      return moveMs(k);
    case "cut":
      return 0;
    case "fade":
      return k.transMs ?? FADE_MS;
    default:
      return k.transMs ?? TRANS_MS;
  }
}
/** A drawable's own timing in its keyframe, if its part (or its turn) has one. */
const ownEnter = (k: Keyframe, d: Drawable) => k.enters?.[d.turn ?? d.owner] ?? k.enters?.[d.owner];
const move = bezier(0.65, 0, 0.35, 1);
const clamp01 = (p: number) => (p < 0 ? 0 : p > 1 ? 1 : p);
/** How far through something `len` ms long it is at `t`: one that takes no time is done. */
const done = (t: number, len: number) => (len > 0 ? clamp01(t / len) : 1);
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
function lerpColor(a: string, b: string, p: number): string {
  const [pa, pb] = [parseColour(a), parseColour(b)];
  if (a === b || !pa || !pb) return p < 0.5 ? a : b;
  return formatColour(pa.map((v, i) => lerp(v, pb[i]!, p)) as RGBA);
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
    else if (typeof va === "string" && typeof vb === "string" && (k === "fill" || k === "stroke" || k === "color")) out[k] = lerpColor(va, vb, p);
  }
  if (a.t === "path" && b.t === "path") out.pts = b.pts.map((q, i) => [lerp(a.pts[i]![0], q[0], p), lerp(a.pts[i]![1], q[1], p)]);
  if (a.t === "text" && b.t === "text" && b.enter === "count") {
    const [na, nb] = [num(a)!, num(b)!];
    if (na !== nb) out.lines = [fmtLike(b.lines.join(""), lerp(na, nb, eases.smooth(p)))];
  }
  return out as Live;
}

const SLIDE: Record<string, [number, number]> = { "from-left": [-1, 0], "from-right": [1, 0], "from-top": [0, -1], "from-bottom": [0, 1] };

/** A part coming in for the first time, `e` ms after its turn began, over `ms` (default: its verb's own length). */
function enter(d: Drawable, e: number, ms?: number): Live | null {
  if (e < 0) return null;
  const verb = d.enter ?? (d.t === "path" ? "draw" : "rise");
  // A length of its own: the verb runs at that pace (0 is there at once).
  if (ms !== undefined) {
    const own = verb === "draw" && d.t !== "path" ? VERB_MS.fade : VERB_MS[verb];
    e = ms <= 0 ? Infinity : (e * own) / ms;
  }
  switch (verb) {
    case "from-left":
    case "from-right":
    case "from-top":
    case "from-bottom": {
      const p = 1 - eases.smooth(clamp01(e / 650));
      const [ux, uy] = SLIDE[verb]!;
      return { ...d, o: d.o * clamp01(e / 250), dx: ux * 160 * p, dy: uy * 160 * p };
    }
    case "wipe":
      return { ...d, reveal: eases.inOut(clamp01(e / 600)) };
    case "blur": {
      const p = eases.smooth(clamp01(e / 600));
      return { ...d, o: d.o * clamp01(e / 300), blur: 18 * (1 - p) };
    }
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

/** The keyframe before `i`, if what stays moves from it (a morph). */
/** A drawable as its steps have made it `tau` ms into its scene (Infinity: as it ends). */
export function stepAt(d: Drawable, tau: number): Drawable {
  if (!d.steps?.length) return d;
  const { steps, ...base } = d;
  let cur = base as Drawable;
  for (const s of steps) {
    const at = s.at ?? 0;
    if (tau <= at) break;
    const to = { ...s.d, id: d.id, owner: d.owner, turn: d.turn, enter: d.enter } as Drawable;
    cur = tween(cur, to, tau === Infinity ? 1 : move(clamp01((tau - at) / (s.ms ?? MORPH_MS)))) as Drawable;
  }
  return cur;
}
const final = (d: Drawable) => stepAt(d, Infinity);

function morphFrom(ks: Keyframe[], i: number): Keyframe | null {
  return i > 0 && (ks[i]!.transition ?? "morph") === "morph" ? ks[i - 1]! : null;
}

/** A cut, a push or a wipe: the scene is there at once, but for its cued parts. */
const whole = (k: Keyframe) => k.transition === "cut" || k.transition === "push" || k.transition === "wipe";

/** The keyframe on screen at `t`. */
export function keyframeAt(ks: Keyframe[], t: number): number {
  const i = ks.findIndex((k) => t < k.start + k.ms);
  return i < 0 ? ks.length - 1 : i;
}

/**
 * When each new part's turn comes, in ms from the scene's start: with the
 * scene, one owner after another once the movers have mostly settled, or
 * with its cue, one after another among those with the same cue.
 */
function turns(ks: Keyframe[], i: number): Map<string, number> {
  const k = ks[i]!;
  const prev = morphFrom(ks, i);
  const before = new Set(prev?.ds.map((d) => d.id));
  const base = k.enter?.delay ?? (prev ? moveMs(k) * 0.55 : i > 0 && k.transition === "fade" ? outMs(k) + 150 : 150);
  const stagger = k.enter?.stagger ?? STAGGER_MS;
  const out = new Map<string, number>();
  const rank = new Map<number, number>();
  for (const d of k.ds) {
    const who = d.turn ?? d.owner;
    // The paper is there from the first frame: it takes no turn, so the first part doesn't wait behind it.
    if (d.owner === "stage" || before.has(d.id) || out.has(who)) continue;
    // With a cue, from its sentence (and its own delay after it); without, its own delay or the scene's.
    const cue = k.cues?.[who] ?? k.cues?.[d.owner];
    const own = ownEnter(k, d)?.delay;
    const at = cue !== undefined ? cue + (own ?? 0) : (own ?? base);
    const n = rank.get(at) ?? 0;
    rank.set(at, n + 1);
    out.set(who, at + n * stagger);
  }
  return out;
}

/** How long after a scene starts its last part has come in (its frames repeat after). */
export function settleMs(ks: Keyframe[], i: number): number {
  const last = Math.max(0, ...turns(ks, i).values());
  const shot = ks[i]!.shots?.at(-1)?.at ?? 0;
  const k = ks[i]!;
  const step = Math.max(0, ...k.ds.flatMap((d) => d.steps?.map((s) => (s.at ?? 0) + (s.ms ?? MORPH_MS)) ?? []));
  // The longest a part takes to come in: the longest verb's own (a count, or typing), or a length given.
  const longest = Math.max(1500, k.enter?.ms ?? 0, ...Object.values(k.enters ?? {}).map((e) => e.ms ?? 0));
  // the last turn, its staggered drawables, and the longest verb; the camera; a transition; the last step
  return Math.max(moveMs(k), last + 12 * 35 + longest, shot + CAM_MS, i > 0 ? outMs(k) : 0, step);
}

const lerpCam = (a: Cam, b: Cam, p: number): Cam => ({ x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p), s: lerp(a.s, b.s, p) });

/** Where the camera is `tau` ms into keyframe `i`: from where the last one left it (in a morph), through each shot. */
export function camAt(ks: Keyframe[], i: number, tau: number): Cam | undefined {
  const shots = ks[i]!.shots;
  if (!shots?.length) return undefined;
  const prev = morphFrom(ks, i);
  let from = prev?.shots?.at(-1)?.cam ?? shots[0]!.cam;
  for (let j = 0; j < shots.length; j++) {
    const at = (t: number) => lerpCam(from, shots[j]!.cam, move(clamp01((t - shots[j]!.at) / CAM_MS)));
    const next = shots[j + 1];
    if (!next || tau < next.at) return at(tau);
    from = at(next.at);
  }
  return from;
}

/** A keyframe as it stands once everything has come in, at the reel's time `t`. */
const settled = (k: Keyframe, t: number): Live[] => k.ds.map(final).map((d) => (d.t === "paint" ? { ...d, now: t } : d));

/**
 * What to paint at `t`: one layer, or, while a scene comes in by a fade, a
 * push or a wipe, the scene before as it ended with this one over or beside it.
 */
export function layersAt(ks: Keyframe[], t: number, W: number): Layer[] {
  const i = keyframeAt(ks, t);
  const k = ks[i]!;
  const tau = t - k.start;
  const now: Layer = { ds: frameAt(ks, t), cam: camAt(ks, i, tau) };
  const tr = i > 0 ? (k.transition ?? "morph") : "morph";
  if (tr === "morph" || tr === "cut") return [now];
  const prev = ks[i - 1]!;
  const old = (o: Partial<Layer>): Layer => ({ ds: settled(prev, t), cam: prev.shots?.at(-1)?.cam, ...o });
  const len = outMs(k);
  if (tr === "fade") return tau < len ? [now, old({ o: 1 - eases.smooth(tau / len) })] : [now];
  if (tau >= len) return [now];
  const p = move(tau / len);
  if (tr === "push") return [old({ dx: -W * p }), { ...now, dx: W * (1 - p) }];
  return [old({}), { ...now, clipW: W * p }];
}

/** Everything on screen at time `t`, in paint order. */
export function frameAt(ks: Keyframe[], t: number): Live[] {
  const i = keyframeAt(ks, t);
  const k = ks[i]!;
  const prev = morphFrom(ks, i);
  const tau = t - k.start;
  // The scene before as it ended, its steps all taken.
  const before = new Map(prev?.ds.map((d) => [d.id, final(d)]));
  const now = new Set(k.ds.map((d) => d.id));
  const mv = moveMs(k);
  const p = move(done(tau, mv));

  // New parts come in one owner at a time, after the movers have mostly settled (or with their cue).
  const turn = turns(ks, i);
  const seen = new Map<string, number>();

  const out: Live[] = [];
  const exiting: Live[] = [];
  for (const d of prev?.ds.map(final) ?? []) {
    if (now.has(d.id)) continue;
    exiting.push({ ...d, o: d.o * (1 - done(tau, (EXIT_MS * mv) / MORPH_MS)) });
  }
  for (const d of k.ds.map((d) => stepAt(d, tau))) {
    const a = before.get(d.id);
    if (a && morphable(a, d)) {
      out.push(tween(a, d, p));
    } else if (a) {
      // Changed content under the same id: the old one fades as both move.
      const ghost = tween(d, a, 1 - p);
      const fading = { ...ghost, id: d.id + "~", o: ghost.o * (1 - done(tau, mv * 0.6)) } as Live;
      if (d.t === "paint" || d.t === "image") {
        // An opaque box: show the new one whole underneath and dissolve the
        // old one off the top, so the paper never shows through.
        out.push({ ...tween(a, d, p), ...(d.t === "paint" ? { key: d.key, fn: d.fn } : { src: d.src }) } as Live, fading);
      } else {
        out.push(fading);
        // Verbs are for first appearances; changed content just fades in (a number still counts).
        const fresh = enter({ ...d, enter: d.enter === "count" ? "count" : "fade" }, tau - mv * 0.3);
        if (fresh) out.push(fresh);
      }
    } else if (d.owner === "stage" || (i > 0 && whole(k) && k.cues?.[d.turn ?? d.owner] === undefined && k.cues?.[d.owner] === undefined && ownEnter(k, d)?.delay === undefined)) {
      // The paper is there from the first frame; so is a scene that cuts, pushes or wipes in (but for a part cued or given a delay).
      out.push(d);
    } else {
      const who = d.turn ?? d.owner;
      const n = seen.get(who) ?? 0;
      seen.set(who, n + 1);
      const delay = turn.get(who)! + Math.min(n, 12) * 35;
      const e = enter(d, tau - delay, ownEnter(k, d)?.ms ?? k.enter?.ms);
      if (e) out.push(e);
    }
  }
  // Leaving parts sit just above the paper, under everything that stays.
  const all = out.length ? [out[0]!, ...exiting, ...out.slice(1)] : exiting;
  // A painted part draws itself from the reel's clock, so it changes every frame.
  return all.map((d) => (d.t === "paint" ? { ...d, now: t } : d));
}
