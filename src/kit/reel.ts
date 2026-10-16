// A kit reel spec made into a canvas reel: the narration sized, the scenes
// timed to it, and a setup that lays every scene out once for the view and
// paints the moment asked for.
// ------------------------------------------------------------------
import type { CanvasReel, Env, View } from "../canvas/types.ts";
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
import { drawLive } from "./draw.ts";
import { frameAt, keyframeAt, settleMs, type Keyframe } from "./engine.ts";
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
  const subtitles = captions ? timing.flatMap((t) => t.say.map((l) => ({ start: l.atMs, end: l.atMs + l.ms, text: l.text }))) : undefined;

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
      frame: stageFrame(stage, insets, captions),
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
    const ks: Keyframe[] = scenes.map((s, i) => {
      const t = timing[i]!;
      // A cued part comes in as its sentence starts.
      const cues: Record<string, number> = {};
      for (const [id, n] of s.cues) if (t.say[n]) cues[id] = t.say[n]!.atMs - t.start;
      return { id: s.id, start: t.start, ms: t.ms, ds: layoutScene(s, ctx), cues };
    });
    return { k, stage, insets, fonts, images, ks };
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
      const { k, ks, fonts, images } = await prepare(view, env);
      const painted = ks.map((kf) => kf.ds.some((d) => d.t === "paint"));
      const settle = ks.map((_, i) => settleMs(ks, i));
      // A scene's frames after its last part came in all look the same.
      const rest = ks.map((kf) => `${view.width}x${view.height}:${fnv1a64(JSON.stringify(kf.ds))}`);
      const dc = { fonts, env, images };
      return (g, ms) => {
        const i = keyframeAt(ks, ms);
        const live = frameAt(ks, ms);
        g.save();
        g.scale(k, k);
        drawLive(g, live, dc);
        g.restore();
        if (painted[i] || (i > 0 && painted[i - 1] && ms - ks[i]!.start < 400)) return undefined;
        if (ms - ks[i]!.start >= settle[i]!) return rest[i];
        return `${view.width}x${view.height}:${fnv1a64(JSON.stringify(live))}`;
      };
    },
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
