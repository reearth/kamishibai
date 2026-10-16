// A kit reel spec made into a canvas reel: the narration sized, the scenes
// timed to it, and a setup that lays every scene out once for the view and
// paints the moment asked for.
// ------------------------------------------------------------------
import type { CanvasReel, Context2D, Env, View } from "../canvas/types.ts";
import { parseAspect } from "../canvas/types.ts";
import { fnv1a64 } from "../fingerprint.ts";
import {
  elevenLabsAdapter,
  geminiAdapter,
  googleAdapter,
  kokoroAdapter,
  openaiAdapter,
  pollyAdapter,
  prepareNarration,
  sayAdapter,
  type NarrationClip,
  type TTSAdapterRef,
} from "../tts/index.ts";
import { check, type Issue } from "./check.ts";
import { drawLayers } from "./draw.ts";
import { keyframeAt, layersAt, settleMs, type Cam, type Keyframe, type Shot } from "./engine.ts";
import type { Bounds } from "./model.ts";
import { normalize, type NormScene } from "./normalize.ts";
import { partDef, type Ctx, type Stage } from "./parts.ts";
import { loadYoga } from "./layout.ts";
import { layoutScene, partBox, stageFrame } from "./stage.ts";
import type { KitReelSpec, PartSpec, VoiceSpec } from "./spec.ts";
import { Fonts, speechMs } from "./text.ts";
import { LONG_SIDE, mergeTheme } from "./theme.ts";

/** Narration starts this long into its scene, as the parts finish moving. */
const LEAD_MS = 400;
/** and the scene holds this long after it ends. */
const TAIL_MS = 700;
/** A scene with nothing to say holds this long. */
const SILENT_MS = 3000;
/** The pause between two sentences of a scene. */
const GAP_MS = 250;
/** The camera moves in no closer than this, by default. */
const MAX_ZOOM = 2.5;

const ADAPTERS: Record<VoiceSpec["provider"], (o: never) => TTSAdapterRef> = {
  say: sayAdapter,
  kokoro: kokoroAdapter,
  openai: openaiAdapter,
  elevenlabs: elevenLabsAdapter,
  google: googleAdapter,
  gemini: geminiAdapter,
  polly: pollyAdapter,
};

function voiceAdapter(v: VoiceSpec): TTSAdapterRef {
  const { provider, ...opts } = v;
  const make = ADAPTERS[provider];
  if (!make) throw new Error(`voice.provider: no adapter "${provider}" (${Object.keys(ADAPTERS).join(", ")})`);
  return make(opts as never);
}

/** One sentence of a scene's narration on the reel's clock: the caption, and its audio ("" with none). */
export type SayTiming = { atMs: number; ms: number; text: string; src: string };

/** Where each scene sits on the reel's clock, with its sentences. */
export type SceneTiming = { id: string; start: number; ms: number; say: SayTiming[] };

/** A canvas reel made by the kit, which can also check its layout. */
export interface KitReel extends CanvasReel {
  timing: SceneTiming[];
  check(view: View, env: Env): Promise<Issue[]>;
}

/**
 * Make a canvas reel from a kit reel spec (plain data, as JSON and YAML
 * carry it, or built with the part functions). Awaits the narration, so the
 * scenes can fit it: `export default await kit({ … })`.
 */
export async function kit(spec: KitReelSpec): Promise<KitReel> {
  const scenes = normalize(spec);
  await loadYoga();
  const theme = mergeTheme(spec.theme);
  const captions = spec.captions ?? true;
  const burn = captions === "burn";

  // ---- the narration, one clip per sentence, and the timeline it sets
  let clips: Record<string, NarrationClip> = {};
  const key = (s: NormScene, i: number) => `${s.id}#${i}`;
  const lines = Object.fromEntries(scenes.flatMap((s) => s.say.map((text, i) => [key(s, i), text])));
  if (spec.voice && Object.keys(lines).length) {
    clips = await prepareNarration(voiceAdapter(spec.voice), lines, { lexicon: spec.lexicon });
  }
  let start = 0;
  const timing: SceneTiming[] = scenes.map((s) => {
    let at = start + LEAD_MS;
    const say = s.say.map((text, i): SayTiming => {
      const clip = clips[key(s, i)];
      const t = { atMs: at, ms: Math.round(clip?.durationMs ?? speechMs(text)), text: clip?.text ?? text, src: clip?.src ?? "" };
      at += t.ms + GAP_MS;
      return t;
    });
    const sayEnd = say.length ? at - GAP_MS - start : 0;
    const ms = s.ms ?? (say.length ? Math.max(2500, sayEnd + TAIL_MS) : SILENT_MS);
    const t: SceneTiming = { id: s.id, start, ms, say };
    start += ms;
    return t;
  });
  const durationMs = start;

  const audio: NonNullable<CanvasReel["audio"]> = [];
  for (const t of timing) t.say.forEach((l, i) => l.src && audio.push({ src: l.src, atMs: l.atMs, label: `${t.id}#${i}` }));
  if (spec.music) {
    audio.push({ src: spec.music.src, atMs: 0, durationMs, loop: true, gain: spec.music.gain ?? -14, duck: spec.music.duck ?? true, fadeOutMs: 1500, label: "music" });
  }
  // Burned captions are in the picture, so there is no track as well.
  const subtitles = captions === true ? timing.flatMap((t) => t.say.map((l) => ({ start: l.atMs, end: l.atMs + l.ms, text: l.text }))) : undefined;

  // ---- one layout per view
  async function prepare(view: View, env: Env) {
    const k = Math.max(view.width, view.height) / LONG_SIDE;
    const stage: Stage = { W: view.width / k, H: view.height / k };
    const ins = view.insets;
    const insets = { top: ins.top / k, right: ins.right / k, bottom: ins.bottom / k, left: ins.left / k };
    const fonts = new Fonts(env.createCanvas(1, 1).getContext("2d"), theme);
    const images = new Map<string, CanvasImageSource>();
    const sizes = new Map<string, { w: number; h: number }>();
    for (const src of imagesOf(scenes)) {
      const img = await env.loadImage(src);
      const im = img as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number };
      images.set(src, img);
      sizes.set(src, { w: im.naturalWidth || im.width || 0, h: im.naturalHeight || im.height || 0 });
    }
    const ctx: Ctx = {
      stage,
      frame: stageFrame(stage, insets, !!captions),
      fonts,
      theme,
      readText: (p) => env.readText(p),
      image: (src) => {
        const img = images.get(src);
        const sz = sizes.get(src);
        return img && sz ? { img, ...sz } : undefined;
      },
      child: (p, flow) => partBox(p as PartSpec & { id: string }, { ...ctx, flow }),
    };
    // The camera's home: the middle of the frame, where a focused part is brought.
    const fr = ctx.frame;
    const anchor = { x: (fr.left + stage.W - fr.right) / 2, y: (fr.top + stage.H - fr.bottom) / 2 };
    const ks: Keyframe[] = scenes.map((s, i) => {
      const t = timing[i]!;
      // A cued part comes in as its sentence starts.
      const cues: Record<string, number> = {};
      for (const [id, n] of s.cues) if (t.say[n]) cues[id] = t.say[n]!.atMs - t.start;
      const boxes = new Map<string, Bounds>();
      const ds = layoutScene(s, ctx, boxes);
      const at = (n: number) => (n && t.say[n] ? t.say[n]!.atMs - t.start : 0);
      const shots: Shot[] = s.focus.map((fc) => ({ at: at(fc.cue), cam: aim(boxes.get(fc.on)!, fc.zoom, stage, fr, anchor) }));
      if (!shots.length || shots[0]!.at > 0) shots.unshift({ at: 0, cam: { ...anchor, s: 1 } });
      return { id: s.id, start: t.start, ms: t.ms, ds, cues, transition: s.transition, shots };
    });
    return { k, stage, insets, fonts, images, ks, anchor, frame: fr };
  }

  return {
    meta: {
      fps: spec.fps ?? 30,
      durationMs,
      width: spec.width ?? 1920,
      height: spec.height ?? 1080,
      aspect: { min: parseAspect(spec.aspect?.min ?? "9:16"), max: parseAspect(spec.aspect?.max ?? "16:9") },
      title: spec.title,
    },
    fonts: spec.fonts,
    audio,
    subtitles,
    timing,
    async check(view, env) {
      const { ks, stage, insets } = await prepare(view, env);
      return check(ks, stage, insets, theme);
    },
    async setup(view, env) {
      const { k, ks, fonts, images, anchor, stage, insets, frame } = await prepare(view, env);
      const lines = timing.flatMap((t) => t.say);
      const caption = burn ? captionPainter(lines, fonts, stage, insets, frame) : undefined;
      const painted = ks.map((kf) => kf.ds.some((d) => d.t === "paint"));
      const settle = ks.map((_, i) => settleMs(ks, i));
      // A scene's frames after its last part came in all look the same.
      const rest = ks.map((kf) => `${view.width}x${view.height}:${fnv1a64(JSON.stringify(kf.ds))}`);
      const dc = { fonts, env, images };
      return (g, ms) => {
        const i = keyframeAt(ks, ms);
        const layers = layersAt(ks, ms, stage.W);
        g.save();
        g.scale(k, k);
        drawLayers(g, layers, dc, anchor, stage.H);
        const cue = caption?.(g, ms) ?? -1;
        g.restore();
        // A painted part changes every frame, and so does the scene before it while this one comes in.
        if (painted[i] || (i > 0 && painted[i - 1] && ms - ks[i]!.start < 800)) return undefined;
        if (ms - ks[i]!.start >= settle[i]!) return `${rest[i]}#${cue}`;
        return `${view.width}x${view.height}:${fnv1a64(JSON.stringify(layers))}#${cue}`;
      };
    },
  };
}

/**
 * The camera framing box `b` at the anchor: as close as fits the frame (never
 * past MAX_ZOOM, or `zoom`), and moved so the stage still fills the view.
 */
export function aim(b: Bounds, zoom: number | undefined, stage: { W: number; H: number }, fr: { top: number; right: number; bottom: number; left: number }, anchor: { x: number; y: number }): Cam {
  const aw = stage.W - fr.left - fr.right;
  const ah = stage.H - fr.top - fr.bottom;
  // Never so close that the part itself is cut off: a zoom only holds the camera back.
  const fit = Math.min(MAX_ZOOM, (aw * 0.85) / Math.max(1, b.w), (ah * 0.85) / Math.max(1, b.h));
  const s = Math.max(1, Math.min(zoom ?? fit, fit));
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  return {
    x: clamp(b.x + b.w / 2, anchor.x / s, stage.W - (stage.W - anchor.x) / s),
    y: clamp(b.y + b.h / 2, anchor.y / s, stage.H - (stage.H - anchor.y) / s),
    s,
  };
}

/**
 * Captions drawn into the picture: the sentence being spoken, light on a
 * dark box, centred in the room kept for them at the foot. Returns the
 * painter, which returns the index of the sentence it drew (-1 for none).
 */
function captionPainter(lines: SayTiming[], fonts: Fonts, stage: { W: number; H: number }, insets: { top: number; right: number; bottom: number; left: number }, fr: { left: number; right: number; bottom: number }) {
  const tall = stage.H > stage.W;
  const size = tall ? 48 : 40;
  const lh = 1.45;
  const padX = size * 0.7;
  const padY = size * 0.35;
  const maxW = stage.W - fr.left - fr.right - padX * 2;
  const laid = lines.map((l) => fonts.balance(l.text, "bold", size, maxW));
  const room = fr.bottom - insets.bottom;
  return (g: Context2D, ms: number): number => {
    const n = lines.findIndex((l) => ms >= l.atMs && ms < l.atMs + l.ms);
    if (n < 0) return -1;
    const ls = laid[n]!;
    const w = Math.max(...ls.map((s) => fonts.measure(s, "bold", size))) + padX * 2;
    const h = ls.length * size * lh + padY * 2;
    const y = stage.H - insets.bottom - room / 2 - h / 2;
    const x = (stage.W - w) / 2;
    g.save();
    g.fillStyle = "rgba(0, 0, 0, 0.62)";
    g.beginPath();
    g.roundRect(x, y, w, h, size * 0.3);
    g.fill();
    g.font = fonts.css("bold", size);
    g.letterSpacing = "0px";
    g.fillStyle = "#ffffff";
    g.textAlign = "center";
    g.textBaseline = "middle";
    ls.forEach((s, i) => g.fillText(s, stage.W / 2, y + padY + (i + 0.5) * size * lh));
    g.restore();
    return n;
  };
}

/** Every image file the scenes draw. */
function imagesOf(scenes: NormScene[]): string[] {
  const out = new Set<string>();
  const walk = (p: PartSpec & { id: string }) => {
    const def = partDef(p.type);
    if (!def) return;
    for (const src of def.images?.(p as never) ?? []) out.add(src);
    for (const [k, fd] of Object.entries(def.fields)) {
      const kids = (p as Record<string, unknown>)[k];
      if (fd.kind === "parts" && Array.isArray(kids)) for (const c of kids) walk(c);
    }
  };
  for (const s of scenes) for (const p of s.parts) walk(p);
  return [...out];
}
