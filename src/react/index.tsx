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
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import type { KamishibaiMeta } from "../protocol.ts";
import type { AudioClip } from "../audio.ts";
import { loadVideo, type DecodedVideo } from "../video.ts";

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

// ---- easing -------------------------------------------------------
// A small cubic-bezier solver (the same curve math the web platform
// uses for timing functions). Returns a function p:[0..1] -> [0..1].
function solveBezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;

  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

  return (p: number): number => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    // Newton-Raphson to invert x(t) = p, then read y(t).
    let t = p;
    for (let i = 0; i < 6; i++) {
      const x = sampleX(t) - p;
      const d = slopeX(t);
      if (Math.abs(x) < 1e-6) break;
      if (Math.abs(d) < 1e-6) break;
      t -= x / d;
    }
    return sampleY(t);
  };
}

export const eases = {
  linear: (p: number) => p,
  smooth: solveBezier(0.16, 1, 0.3, 1), // crisp deceleration, no overshoot
  inOut: solveBezier(0.45, 0, 0.55, 1), // balanced
  pop: solveBezier(0.34, 1.56, 0.64, 1), // slight overshoot
};

export type Ease = (p: number) => number;

// ---- ramp ---------------------------------------------------------
// Map a time window [fromMs, toMs] onto [fromV, toV], clamped at both
// ends, shaped by an easing curve. Scalar args by design — no arrays.
export function ramp(
  ms: number,
  fromMs: number,
  toMs: number,
  fromV: number,
  toV: number,
  ease: Ease = eases.linear,
): number {
  if (toMs <= fromMs) return ms < fromMs ? fromV : toV;
  const raw = (ms - fromMs) / (toMs - fromMs);
  const p = raw < 0 ? 0 : raw > 1 ? 1 : raw;
  return fromV + (toV - fromV) * ease(p);
}

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
  /** fade-out over this many ms (needs durationMs) */
  fadeOutMs?: number;
}> = ({ src, atMs, delayMs = 0, gain, trimStartMs, durationMs, fadeInMs, fadeOutMs }) => {
  const { epochMs } = useClock();
  const start = Math.round(atMs ?? epochMs + delayMs);
  useEffect(() => {
    const clip: AudioClip = { src, atMs: start };
    if (gain != null) clip.gain = gain;
    if (trimStartMs != null) clip.trimStartMs = trimStartMs;
    if (durationMs != null) clip.durationMs = durationMs;
    if (fadeInMs != null) clip.fadeInMs = fadeInMs;
    if (fadeOutMs != null) clip.fadeOutMs = fadeOutMs;
    registerAudio(clip);
  }, [src, start, gain, trimStartMs, durationMs, fadeInMs, fadeOutMs]);
  return null;
};

// ---- Series -------------------------------------------------------
// A list of scenes laid out back-to-back, each with its own local clock.
// A scene can crossfade in over `crossfadeMs`, overlapping the previous one
// (so scene i starts at sum(prev durations) - sum(prev crossfades)).
export interface SceneProps {
  durationMs: number;
  /** crossfade-in length in ms; overlaps the previous scene (default 0) */
  crossfadeMs?: number;
  children: React.ReactNode;
}

const SeriesScene: React.FC<SceneProps> = () => null; // marker; handled by Series

export interface SeriesComponent extends React.FC<{ children: React.ReactNode }> {
  Scene: React.FC<SceneProps>;
}

const SeriesBase: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const clock = useClock();
  const scenes = React.Children.toArray(children).filter(
    (c): c is React.ReactElement<SceneProps> =>
      React.isValidElement(c) && c.type === SeriesScene,
  );

  // start_i = start_{i-1} + dur_{i-1} - crossfade_i
  const starts: number[] = [];
  let cursor = 0;
  scenes.forEach((s, i) => {
    const xf = i === 0 ? 0 : (s.props.crossfadeMs ?? 0);
    cursor -= xf;
    starts.push(cursor);
    cursor += s.props.durationMs;
  });

  return (
    <>
      {scenes.map((scene, i) => {
        const start = starts[i]!;
        const dur = scene.props.durationMs;
        const end = start + dur;
        if (clock.ms < start || clock.ms >= end) return null;
        const local = clock.ms - start;

        const xfIn = i > 0 ? (scene.props.crossfadeMs ?? 0) : 0;
        const next = scenes[i + 1];
        const xfOut = next ? (next.props.crossfadeMs ?? 0) : 0;
        let opacity = 1;
        if (xfIn > 0 && local < xfIn) opacity = Math.min(opacity, local / xfIn);
        if (xfOut > 0 && local >= dur - xfOut) {
          opacity = Math.min(opacity, (dur - local) / xfOut);
        }

        return (
          <div key={i} style={{ position: "absolute", inset: 0, opacity }}>
            <ClockProvider
              value={{ ...clock, ms: local, durationMs: dur, epochMs: clock.epochMs + start }}
            >
              {scene.props.children}
            </ClockProvider>
          </div>
        );
      })}
    </>
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
  style?: React.CSSProperties;
}> = ({ src, startMs = 0, muted, audioSrc, gain, fadeInMs, fadeOutMs, style }) => {
  const { epochMs, durationMs } = useClock();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const epochRef = useRef(epochMs);
  epochRef.current = epochMs;

  // By default, composite the clip's own audio: register it as a marker,
  // placed at the clip's start and trimmed to the rest of this scope. The
  // renderer resolves the path (via --public) and skips it if the file has
  // no audio stream. Set `muted` to opt out.
  const audioPath = audioSrc ?? src;
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
    registerAudio(clip);
  }, [muted, audioPath, epochMs, startMs, durationMs, gain, fadeInMs, fadeOutMs]);

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
      const bmp = v.frameAtMs(localMs);
      ctx.clearRect(0, 0, c.width, c.height);
      if (bmp) ctx.drawImage(bmp, 0, 0);
    };
    return registerSettler(settler);
  }, [src, startMs]);

  return (
    <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block", ...style }} />
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
          setDriven(true);
          setMs(target);
          // Let React commit the new tree, run any settlers (e.g. video
          // frame decode/draw) for this ms, then settle the paint.
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
