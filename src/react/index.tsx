// kamishibai/react — optional thin sugar for building reels with React.
// ------------------------------------------------------------------
// You do NOT need this. Any page that sets window.kamishibai works. This
// just wires a React tree to the contract and gives you a clock-driven
// vocabulary that's deliberately its own:
//   - the clock is measured in MILLISECONDS (`ms`)
//   - `ramp()`  maps a time window onto a value range
//   - `<Cue>`   reveals children during a time window (with a local clock)
//   - `<Stage>` is the root surface
//   - `mount()` renders a tree and exposes window.kamishibai for you
// ------------------------------------------------------------------
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import type { KamishibaiMeta } from "../protocol.ts";
import type { AudioClip, DuckOptions } from "../audio.ts";
import { loadVideo, type DecodedVideo } from "../video.ts";
import { loadSubtitles, cueAt, type Cue as SubtitleCue } from "../subtitle.ts";
export type { Cue as SubtitleCue } from "../subtitle.ts";
import type { NarrationClip } from "../tts/index.ts";
export type { NarrationClip } from "../tts/index.ts";
// Re-exported so narration layout pairs naturally with <Series scenes> here;
// they live framework-free in kamishibai/tts.
export {
  narrationTotal,
  narrationLayout,
  narrationSequence,
} from "../tts/index.ts";
export type {
  NarrationLayoutOptions,
  NarrationScene,
  NarrationStep,
} from "../tts/index.ts";
import { eases, ramp, type Ease } from "../easing.ts";
import { seriesLayout, type SceneSpec, type SceneLayout } from "../series.ts";

// Re-exported so authors can size meta.durationMs to a Series without
// hand-summing crossfades (these live framework-free in kamishibai/series).
export { seriesDuration, seriesLayout } from "../series.ts";
export type { SceneSpec, SceneLayout } from "../series.ts";
export type { DuckOptions } from "../audio.ts";

// Re-exported for convenience (these live framework-free in kamishibai/easing).
export {
  bezier,
  eases,
  ramp,
  spring,
  track,
  stagger,
  interpolateColor,
  type Ease,
  type SpringConfig,
  type TrackStop,
  type StaggerOptions,
} from "../easing.ts";

export type Clock = {
  /** elapsed time in milliseconds since the start of the current scope */
  ms: number;
  /** total length of the current scope in milliseconds */
  durationMs: number;
  /** ticks per second the renderer will sample */
  fps: number;
  /** the global ms at which this scope's local ms === 0 (for audio markers) */
  epochMs: number;
};

const ClockContext = createContext<Clock>({ ms: 0, durationMs: 0, fps: 30, epochMs: 0 });

export const ClockProvider = ClockContext.Provider;
export const useClock = (): Clock => useContext(ClockContext);

// ---- Stage --------------------------------------------------------
export const Stage: React.FC<{
  children: React.ReactNode;
  background?: string;
  style?: React.CSSProperties;
}> = ({ children, background, style }) => (
  <div
    style={{
      position: "absolute",
      inset: 0,
      overflow: "hidden",
      background,
      ...style,
    }}
  >
    {children}
  </div>
);

// ---- Cue ----------------------------------------------------------
// Reveal children starting at `at` ms (optionally only for `hold` ms),
// and hand them a LOCAL clock that starts at zero when the cue begins.
export const Cue: React.FC<{
  at: number;
  hold?: number;
  children: React.ReactNode;
}> = ({ at, hold, children }) => {
  const clock = useClock();
  if (clock.ms < at) return null;
  if (hold != null && clock.ms >= at + hold) return null;
  return (
    <ClockProvider
      value={{
        ...clock,
        ms: clock.ms - at,
        durationMs: hold ?? clock.durationMs - at,
        epochMs: clock.epochMs + at,
      }}
    >
      {children}
    </ClockProvider>
  );
};

// ---- Enter --------------------------------------------------------
// Convenience: fade + rise an element in over `dur` ms after `at` ms,
// driven entirely by the clock (no CSS transitions).
export const Enter: React.FC<{
  at?: number;
  dur?: number;
  lift?: number;
  ease?: Ease;
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ at = 0, dur = 700, lift = 26, ease = eases.smooth, style, children }) => {
  const { ms } = useClock();
  const p = ramp(ms, at, at + dur, 0, 1, ease);
  return (
    <div
      style={{
        opacity: p,
        transform: `translateY(${(1 - p) * lift}px)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

// ---- audio markers ------------------------------------------------
// Audio is declared as part of the tree. When an <Audio> mounts it records
// a marker (src + the global ms it starts at); the renderer reads these off
// window.kamishibai.audio after capture and muxes them. This makes audio
// composable: drop an <Audio> inside any scene and it lands at that scene's
// start. The same convention works without React — set window.kamishibai
// .audio to an array and push { src, atMs, gain } yourself.
const audioRegistry: AudioClip[] = [];
const audioSeen = new Set<string>();

function registerAudio(clip: AudioClip): void {
  const key = `${clip.src}@${clip.atMs}@${clip.gain ?? 0}`;
  if (audioSeen.has(key)) return;
  audioSeen.add(key);
  audioRegistry.push(clip);
}

function resetAudio(): void {
  audioRegistry.length = 0;
  audioSeen.clear();
}

/**
 * Declare an audio clip. It starts at this scope's epoch (e.g. the enclosing
 * Series.Scene / Cue start) plus `delayMs`, or at an explicit `atMs`.
 * Renders nothing — kamishibai never plays or fetches it, only records it.
 */
export const Audio: React.FC<{
  src: string;
  /** absolute start in ms (overrides epoch + delayMs) */
  atMs?: number;
  /** offset from the enclosing scope's start, in ms (default 0) */
  delayMs?: number;
  /** volume in dB (negative = quieter) */
  gain?: number;
  /** start offset into the source file, in ms */
  trimStartMs?: number;
  /** how much of the source to use, in ms */
  durationMs?: number;
  /** fade-in over this many ms */
  fadeInMs?: number;
  /** fade-out over this many ms (needs a known end: durationMs, or loop + reel) */
  fadeOutMs?: number;
  /** tile the source to fill to the reel end (or durationMs) — for BGM */
  loop?: boolean;
  /** auto-dip this clip while other clips play (true = defaults) — for BGM */
  duck?: boolean | DuckOptions;
  /** dB volume automation over the clip's timeline (atMs from clip start) */
  gainKeyframes?: Array<{ atMs: number; gain: number }>;
}> = ({ src, atMs, delayMs = 0, gain, trimStartMs, durationMs, fadeInMs, fadeOutMs, loop, duck, gainKeyframes }) => {
  const { epochMs } = useClock();
  const start = Math.round(atMs ?? epochMs + delayMs);
  const kfKey = gainKeyframes ? JSON.stringify(gainKeyframes) : "";
  const duckKey = duck ? JSON.stringify(duck) : "";
  useEffect(() => {
    const clip: AudioClip = { src, atMs: start };
    if (gain != null) clip.gain = gain;
    if (trimStartMs != null) clip.trimStartMs = trimStartMs;
    if (durationMs != null) clip.durationMs = durationMs;
    if (fadeInMs != null) clip.fadeInMs = fadeInMs;
    if (fadeOutMs != null) clip.fadeOutMs = fadeOutMs;
    if (loop) clip.loop = true;
    if (duck) clip.duck = duck;
    if (gainKeyframes != null) clip.gainKeyframes = gainKeyframes;
    registerAudio(clip);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, start, gain, trimStartMs, durationMs, fadeInMs, fadeOutMs, loop, duckKey, kfKey]);
  return null;
};

/**
 * Background music: a looped <Audio> placed at the reel start. Tiles `src` to
 * fill the whole video (so a short loop covers a long reel) and clamps to the
 * reel end — drop it at the top level, alongside your scenes' narration, and it
 * mixes in underneath them (narration and BGM both mux; neither is dropped).
 */
export const Bgm: React.FC<{
  src: string;
  /** when the music starts, in ms from the reel start (default 0) */
  atMs?: number;
  /** volume in dB — usually negative so it sits under narration, e.g. -18 */
  gain?: number;
  /** start offset into the source file, in ms */
  trimStartMs?: number;
  /** fade-in over this many ms */
  fadeInMs?: number;
  /** fade-out over this many ms, ending at the reel end */
  fadeOutMs?: number;
  /** auto-dip under narration/other clips (true = defaults, or tune the dip) */
  duck?: boolean | DuckOptions;
  /** dB volume automation (atMs from the reel start) — manual alternative to duck */
  gainKeyframes?: Array<{ atMs: number; gain: number }>;
}> = ({ src, atMs = 0, gain, trimStartMs, fadeInMs, fadeOutMs, duck, gainKeyframes }) => (
  <Audio
    src={src}
    atMs={atMs}
    loop
    gain={gain}
    trimStartMs={trimStartMs}
    fadeInMs={fadeInMs}
    fadeOutMs={fadeOutMs}
    duck={duck}
    gainKeyframes={gainKeyframes}
  />
);

// ---- Series -------------------------------------------------------
// A list of scenes laid out back-to-back, each with its own local clock.
// A scene can crossfade in over `crossfadeMs`, overlapping the previous one
// (so scene i starts at Σ prev durations − Σ prev crossfades).
//
// Scenes discover themselves: each <Series.Scene> registers its timing with
// the enclosing <Series> from a layout effect — the same mechanism <Audio>
// and the settler barrier use. So a scene wrapped in your own component works
// at any depth; there's no fragile "must be a direct child" rule. Registration
// order is the source order, so keep scenes statically ordered. You can also
// drive a Series from data via the `scenes` prop (handy with seriesDuration /
// narration-sized layouts).
export interface SceneProps extends SceneSpec {
  children: React.ReactNode;
}

/** A data-driven scene: timing plus the content to render for it. */
export interface SceneItem extends SceneSpec {
  /** the scene's content, rendered with a scene-local clock */
  content: React.ReactNode;
}

interface SeriesContextValue {
  register: (id: string, spec: SceneSpec) => void;
  unregister: (id: string) => void;
  layout: Map<string, SceneLayout>;
}
const SeriesContext = createContext<SeriesContextValue | null>(null);

const SeriesScene: React.FC<SceneProps> = ({ durationMs, crossfadeMs, exitFadeMs, children }) => {
  const series = useContext(SeriesContext);
  const clock = useClock();
  const id = useId();

  const register = series?.register;
  const unregister = series?.unregister;
  useLayoutEffect(() => {
    if (!register || !unregister) {
      console.warn("kamishibai: <Series.Scene> must be rendered inside a <Series>.");
      return;
    }
    register(id, { durationMs, crossfadeMs, exitFadeMs });
    return () => unregister(id);
  }, [register, unregister, id, durationMs, crossfadeMs, exitFadeMs]);

  // No placement yet means the registry hasn't settled (first commit) or this
  // scene is outside a Series — render nothing until we know where it lands.
  const place = series?.layout.get(id);
  if (!place) return null;

  const { start, xfIn, xfOut } = place;
  const end = start + durationMs;
  if (clock.ms < start || clock.ms >= end) return null;
  const local = clock.ms - start;

  // Background crossfade: overlap the neighbours at partial opacity.
  let opacity = 1;
  if (xfIn > 0 && local < xfIn) opacity = Math.min(opacity, local / xfIn);
  if (xfOut > 0 && local >= durationMs - xfOut) {
    opacity = Math.min(opacity, (durationMs - local) / xfOut);
  }

  // Content exit-fade (anti-ghosting): fade this scene's content out over its
  // last exitFadeMs, so it's gone before the next scene crossfades in and only
  // the backgrounds blend. Authored as an inner layer over the crossfade.
  let contentOpacity = 1;
  if (exitFadeMs && exitFadeMs > 0 && local >= durationMs - exitFadeMs) {
    contentOpacity = Math.max(0, (durationMs - local) / exitFadeMs);
  }

  const inner = (
    <ClockProvider value={{ ...clock, ms: local, durationMs, epochMs: clock.epochMs + start }}>
      {children}
    </ClockProvider>
  );

  return (
    <div style={{ position: "absolute", inset: 0, opacity }}>
      {contentOpacity < 1 ? (
        <div style={{ position: "absolute", inset: 0, opacity: contentOpacity }}>{inner}</div>
      ) : (
        inner
      )}
    </div>
  );
};

export interface SeriesProps {
  children?: React.ReactNode;
  /** data-driven scenes, an alternative (or addition) to JSX children */
  scenes?: SceneItem[];
}

export interface SeriesComponent extends React.FC<SeriesProps> {
  Scene: React.FC<SceneProps>;
}

const SeriesBase: React.FC<SeriesProps> = ({ children, scenes }) => {
  const [regs, setRegs] = useState<Array<{ id: string } & SceneSpec>>([]);
  // id -> source order. Persistent (never deleted) so a scene that re-registers
  // (StrictMode remount, prop change) keeps its place; assigned once, in the
  // order scenes first register, which is their layout-effect (source) order.
  const order = useRef(new Map<string, number>());
  const counter = useRef(0);

  const register = useCallback((id: string, spec: SceneSpec) => {
    setRegs((prev) => {
      if (!order.current.has(id)) order.current.set(id, counter.current++);
      const existing = prev.find((r) => r.id === id);
      if (
        existing &&
        existing.durationMs === spec.durationMs &&
        existing.crossfadeMs === spec.crossfadeMs &&
        existing.exitFadeMs === spec.exitFadeMs
      ) {
        return prev; // unchanged — keep the same reference, no re-render loop
      }
      const next = prev.filter((r) => r.id !== id);
      next.push({ id, ...spec });
      next.sort((a, b) => order.current.get(a.id)! - order.current.get(b.id)!);
      return next;
    });
  }, []);

  const unregister = useCallback((id: string) => {
    setRegs((prev) => (prev.some((r) => r.id === id) ? prev.filter((r) => r.id !== id) : prev));
  }, []);

  const layout = useMemo(() => {
    const placed = seriesLayout(regs);
    const map = new Map<string, SceneLayout>();
    regs.forEach((r, i) => map.set(r.id, placed[i]!));
    return map;
  }, [regs]);

  const ctx = useMemo<SeriesContextValue>(
    () => ({ register, unregister, layout }),
    [register, unregister, layout],
  );

  return (
    <SeriesContext.Provider value={ctx}>
      {children}
      {scenes?.map((s, i) => (
        <SeriesScene
          key={`__series_scene_${i}`}
          durationMs={s.durationMs}
          crossfadeMs={s.crossfadeMs}
          exitFadeMs={s.exitFadeMs}
        >
          {s.content}
        </SeriesScene>
      ))}
    </SeriesContext.Provider>
  );
};

export const Series = SeriesBase as SeriesComponent;
Series.Scene = SeriesScene;

// ---- seek barrier -------------------------------------------------
// Some content needs async work to be *ready* for a given ms before the
// screenshot — e.g. decoding a video frame. Components register a settler;
// mount's seek awaits all of them (for the target ms) before resolving.
// Settlers register in a layout effect, so they're in place before seek's
// post-commit rAF runs — no first-frame race, even at chunk boundaries.
type Settler = (ms: number) => Promise<void> | void;
const settlers = new Set<Settler>();

function registerSettler(fn: Settler): () => void {
  settlers.add(fn);
  return () => {
    settlers.delete(fn);
  };
}

// ---- Video --------------------------------------------------------
// Frame-accurate video, decoded with WebCodecs (see kamishibai/video) and
// drawn to a canvas for the current frame. Deterministic, unlike a raw
// <video> seek. The src must be fetchable by the browser (e.g. --public).
const videoCache = new Map<string, Promise<DecodedVideo>>();
function loadVideoCached(src: string): Promise<DecodedVideo> {
  let p = videoCache.get(src);
  if (!p) {
    p = loadVideo(src);
    videoCache.set(src, p);
  }
  return p;
}

export const Video: React.FC<{
  src: string;
  /** when, in this scope's local ms, the clip starts playing (default 0) */
  startMs?: number;
  /** drop the clip's audio (by default it's muxed automatically) */
  muted?: boolean;
  /** override the path ffmpeg reads the audio from (defaults to src, which
   *  the renderer resolves against --public) */
  audioSrc?: string;
  /** gain (dB) for the muxed audio */
  gain?: number;
  /** fade-in / fade-out (ms) for the muxed audio */
  fadeInMs?: number;
  fadeOutMs?: number;
  /** dB volume automation for the muxed audio (atMs from the clip start) */
  gainKeyframes?: Array<{ atMs: number; gain: number }>;
  style?: React.CSSProperties;
}> = ({ src, startMs = 0, muted, audioSrc, gain, fadeInMs, fadeOutMs, gainKeyframes, style }) => {
  const { epochMs, durationMs } = useClock();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const epochRef = useRef(epochMs);
  epochRef.current = epochMs;

  // By default, composite the clip's own audio: register it as a marker,
  // placed at the clip's start and trimmed to the rest of this scope. The
  // renderer resolves the path (via --public) and skips it if the file has
  // no audio stream. Set `muted` to opt out.
  const audioPath = audioSrc ?? src;
  const kfKey = gainKeyframes ? JSON.stringify(gainKeyframes) : "";
  useEffect(() => {
    if (muted) return;
    const clip: AudioClip = {
      src: audioPath,
      atMs: Math.round(epochMs + startMs),
      durationMs: Math.max(0, Math.round(durationMs - startMs)),
    };
    if (gain != null) clip.gain = gain;
    if (fadeInMs != null) clip.fadeInMs = fadeInMs;
    if (fadeOutMs != null) clip.fadeOutMs = fadeOutMs;
    if (gainKeyframes != null) clip.gainKeyframes = gainKeyframes;
    registerAudio(clip);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muted, audioPath, epochMs, startMs, durationMs, gain, fadeInMs, fadeOutMs, kfKey]);

  useLayoutEffect(() => {
    const loaded = loadVideoCached(src);
    let video: DecodedVideo | undefined;
    void loaded.then((v) => {
      video = v;
      const c = canvasRef.current;
      if (c) {
        c.width = v.width;
        c.height = v.height;
      }
    });
    const settler: Settler = async (globalMs) => {
      const v = video ?? (await loaded);
      video = v;
      const c = canvasRef.current;
      if (!c) return;
      if (c.width !== v.width) {
        c.width = v.width;
        c.height = v.height;
      }
      const ctx = c.getContext("2d");
      if (!ctx) return;
      const localMs = globalMs - epochRef.current - startMs;
      const bmp = await v.frameAtMs(localMs);
      ctx.clearRect(0, 0, c.width, c.height);
      if (bmp) ctx.drawImage(bmp, 0, 0);
    };
    return registerSettler(settler);
  }, [src, startMs]);

  return (
    <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block", ...style }} />
  );
};

// ---- Subtitle -----------------------------------------------------
// Burn captions from an SRT/VTT file into the frames: the active cue for the
// current (scene-local) ms is drawn. Composable — drop it into a scene and
// its cue times count from that scene's start (+ delayMs). The src must be
// fetchable by the browser (e.g. --public).
const subtitleCache = new Map<string, Promise<SubtitleCue[]>>();
function loadSubtitlesCached(src: string): Promise<SubtitleCue[]> {
  let p = subtitleCache.get(src);
  if (!p) {
    p = loadSubtitles(src);
    subtitleCache.set(src, p);
  }
  return p;
}

export const Subtitle: React.FC<{
  /** a subtitle file (SRT/VTT), fetchable by the browser (e.g. --public) */
  src?: string;
  /** inline cues instead of a file */
  cues?: SubtitleCue[];
  /** static caption text shown while mounted — compose timing with <Cue> */
  children?: React.ReactNode;
  /** shift all cue times by this many ms (src / cues modes) */
  delayMs?: number;
  /** distance from the bottom edge, in px (default 80) */
  bottom?: number;
  /** style overrides for the caption text box */
  style?: React.CSSProperties;
}> = ({ src, cues, children, delayMs = 0, bottom = 80, style }) => {
  const { epochMs } = useClock();
  const ref = useRef<HTMLDivElement>(null);
  const epochRef = useRef(epochMs);
  epochRef.current = epochMs;

  // src/cues drive the active cue per frame; otherwise children is a static
  // caption (timing comes from the enclosing <Cue>/<Series.Scene>).
  const dynamic = src != null || cues != null;
  const cuesKey = cues ? JSON.stringify(cues) : "";

  useLayoutEffect(() => {
    if (!dynamic) return;
    const pending = cues ? null : loadSubtitlesCached(src!);
    let resolved: SubtitleCue[] | undefined = cues ?? undefined;
    if (pending) void pending.then((c) => (resolved = c));
    const settler: Settler = async (globalMs) => {
      const cs = resolved ?? (await pending!);
      resolved = cs;
      const el = ref.current;
      if (!el) return;
      const cue = cueAt(cs, globalMs - epochRef.current - delayMs);
      el.textContent = cue ? cue.text : "";
      // Only show the box when there's a cue (so gaps are invisible).
      el.style.background = cue ? "rgba(0,0,0,0.62)" : "transparent";
      el.style.padding = cue ? "8px 22px" : "0";
    };
    return registerSettler(settler);
  }, [dynamic, src, cuesKey, delayMs]);

  const boxStyle: React.CSSProperties = {
    display: "inline-block",
    maxWidth: "80%",
    borderRadius: 10,
    whiteSpace: "pre-line",
    fontFamily: '"Hiragino Sans", "Noto Sans JP", system-ui, sans-serif',
    fontSize: 40,
    fontWeight: 600,
    lineHeight: 1.35,
    color: "#fff",
    textShadow: "0 2px 8px rgba(0,0,0,0.55)",
    // static text shows its box immediately; dynamic toggles bg per cue.
    ...(dynamic ? null : { background: "rgba(0,0,0,0.62)", padding: "8px 22px" }),
    ...style,
  };

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom,
        textAlign: "center",
        pointerEvents: "none",
      }}
    >
      {dynamic ? <div ref={ref} style={boxStyle} /> : <div style={boxStyle}>{children}</div>}
    </div>
  );
};

// ---- Narration ----------------------------------------------------
// Thin sugar over <Audio>: drop a clip from prepareNarration into a scene and
// it plays from the scene start (+ delayMs), trimmed to its own length. With
// `subtitle`, the same text is also burned as a caption for the clip's window
// — text → voice → caption, all from one source. No new mux path; it rides
// the existing <Audio> + <Subtitle> machinery.
export const Narration: React.FC<{
  /** a clip returned by prepareNarration ({ src, durationMs, text }) */
  clip: NarrationClip;
  /** absolute start in ms (overrides epoch + delayMs) */
  atMs?: number;
  /** offset from the enclosing scope's start, in ms (default 0) */
  delayMs?: number;
  /** volume in dB (negative = quieter) */
  gain?: number;
  /** fade-in over this many ms */
  fadeInMs?: number;
  /** fade-out over this many ms (at the clip's end) */
  fadeOutMs?: number;
  /** also burn the narration text as a caption for the clip's window */
  subtitle?: boolean;
  /** caption distance from the bottom edge, in px (default 80) */
  subtitleBottom?: number;
  /** caption style overrides */
  subtitleStyle?: React.CSSProperties;
}> = ({ clip, atMs, delayMs = 0, gain, fadeInMs, fadeOutMs, subtitle, subtitleBottom, subtitleStyle }) => {
  return (
    <>
      {clip.src ? (
        <Audio
          src={clip.src}
          atMs={atMs}
          delayMs={delayMs}
          durationMs={clip.durationMs}
          gain={gain}
          fadeInMs={fadeInMs}
          fadeOutMs={fadeOutMs}
        />
      ) : null}
      {subtitle ? (
        <Cue at={delayMs} hold={clip.durationMs}>
          <Subtitle bottom={subtitleBottom} style={subtitleStyle}>
            {clip.text}
          </Subtitle>
        </Cue>
      ) : null}
    </>
  );
};

// ---- mount --------------------------------------------------------
// Render a scene and expose window.kamishibai = { meta, seek, audio } so the
// headless renderer can drive it. In a normal browser (no driver) it
// free-runs on the wall clock for a live preview.
export interface MountOptions {
  /** where to mount; defaults to #kamishibai-root, else document.body */
  container?: HTMLElement;
  /** free-run on the wall clock when not being driven (default: true) */
  livePreview?: boolean;
}

const Driver: React.FC<{
  scene: React.ReactNode;
  meta: KamishibaiMeta;
  livePreview: boolean;
}> = ({ scene, meta, livePreview }) => {
  const [ms, setMs] = useState(0);
  const [driven, setDriven] = useState(false);

  useEffect(() => {
    // The seek hook resolves after a settled paint (double rAF). The live
    // `audioRegistry` array is exposed so the renderer can read markers that
    // <Audio> components push as the tree mounts across the timeline.
    window.kamishibai = {
      meta,
      seek: (target: number) =>
        new Promise<void>((resolve) => {
          // Commit the new tree SYNCHRONOUSLY before doing anything else.
          // Without flushSync, React 18 may schedule the state update
          // concurrently and the rAF chain below can run (and a screenshot
          // be taken) against a DOM that still shows the previous ms — which
          // produced rare single-frame "flashes" of the initial frame under
          // parallel capture. flushSync guarantees the DOM reflects `target`
          // before we run settlers and settle the paint.
          flushSync(() => {
            setDriven(true);
            setMs(target);
          });
          // DOM is committed; run any settlers (e.g. video frame decode/draw)
          // for this ms, then settle the paint (rAF) before resolving.
          requestAnimationFrame(() => {
            Promise.all([...settlers].map((s) => s(target)))
              .catch(() => {})
              .then(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
          });
        }),
      audio: audioRegistry,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (driven || !livePreview) return;
    let raf = 0;
    const t0 = performance.now();
    const loop = () => {
      setMs((performance.now() - t0) % meta.durationMs);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [driven, livePreview, meta.durationMs]);

  return (
    <ClockProvider value={{ ms, durationMs: meta.durationMs, fps: meta.fps, epochMs: 0 }}>
      {scene}
    </ClockProvider>
  );
};

export function mount(
  scene: React.ReactNode,
  meta: KamishibaiMeta,
  options: MountOptions = {},
): void {
  resetAudio();
  const host =
    options.container ?? document.getElementById("kamishibai-root") ?? document.body;
  const stage = document.createElement("div");
  stage.style.cssText =
    `position:absolute;top:0;left:0;width:${meta.width}px;height:${meta.height}px;overflow:hidden;`;
  host.appendChild(stage);
  createRoot(stage).render(
    <Driver scene={scene} meta={meta} livePreview={options.livePreview ?? true} />,
  );
}

export type { KamishibaiMeta } from "../protocol.ts";
