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
import { createClipRegistry, type AudioClip, type DuckOptions } from "../audio.ts";
import { loadVideo, type DecodedVideo } from "../video.ts";
import { loadSubtitles, cueAt, isPlayableCue, warnUnplayable, type Cue as SubtitleCue } from "../subtitle.ts";
export type { Cue as SubtitleCue } from "../subtitle.ts";
import type { NarrationClip, NarrationStep } from "../tts/index.ts";
export type { NarrationClip } from "../tts/index.ts";
// Re-exported so narration layout pairs naturally with <Series scenes> here;
// they live framework-free in kamishibai/tts.
export {
  narrationTotal,
  narrationLayout,
  narrationSequence,
  narrationScene,
} from "../tts/index.ts";
export type {
  NarrationLayoutOptions,
  NarrationScene,
  NarrationStep,
  NarrationSequenceOptions,
  NarrationSceneOptions,
  NarrationSceneLayout,
} from "../tts/index.ts";
import { eases, ramp, type Ease } from "../easing.ts";
import { cameraAt, cameraTransform, type CameraShot, type CameraState } from "../camera.ts";
export { cameraAt, cameraTransform } from "../camera.ts";
export type { CameraShot, CameraState } from "../camera.ts";
import { seriesLayout, exitFadeOpacity, type SceneSpec, type SceneLayout } from "../series.ts";
import { fnv1a64 } from "../fingerprint.ts";

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
// A <Series.Scene> with an exit-fade hands its content opacity down. The
// outermost <Stage>(s) inside it claim that fade: the `background` prop stays
// opaque on a layer of its own and only the Stage's children (and `style`)
// fade, so a crossfade blends the scenes' backgrounds without ghosting their
// content. Stages nested in those see no fade (the outer one applies it).
interface SceneFade {
  opacity: number;
  claim: () => () => void;
}
const SceneFadeContext = createContext<SceneFade | null>(null);

export const Stage: React.FC<{
  children: React.ReactNode;
  background?: string;
  style?: React.CSSProperties;
}> = ({ children, background, style }) => {
  const fade = useContext(SceneFadeContext);
  const claim = fade?.claim;
  useLayoutEffect(() => claim?.(), [claim]);
  const body = (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        background: fade ? undefined : background,
        ...style,
        ...(fade ? { opacity: Number(style?.opacity ?? 1) * fade.opacity } : null),
      }}
    >
      <SceneFadeContext.Provider value={null}>{children}</SceneFadeContext.Provider>
    </div>
  );
  if (!fade) return body;
  return (
    <>
      <div style={{ position: "absolute", inset: 0, background }} />
      {body}
    </>
  );
};

// ---- Camera -------------------------------------------------------
// Lay children out in "world" coordinates and film them: the world point
// (x, y) sits at the frame center, scaled by `zoom`. Pass a fixed state, or
// `shots` keyframes on the current clock (see cameraAt) for push-ins, pans and
// pull-backs. Pure transforms — deterministic per frame like everything else.
export const Camera: React.FC<
  Partial<CameraState> & {
    /** keyframes on this scope's clock; overrides x / y / zoom / rotate */
    shots?: CameraShot[];
    style?: React.CSSProperties;
    children: React.ReactNode;
  }
> = ({ shots, x = 0, y = 0, zoom = 1, rotate = 0, style, children }) => {
  const { ms } = useClock();
  const cam = shots ? cameraAt(ms, shots) : { x, y, zoom, rotate };
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", ...style }}>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transformOrigin: "0 0",
          transform: cameraTransform(cam),
        }}
      >
        {children}
      </div>
    </div>
  );
};

// ---- frame sampling -------------------------------------------------
// The renderer only ever seeks to frame times (i * 1000 / fps), so a window
// [at, at + len) shorter than one frame interval can fall between two samples
// and never mount — and markers inside it (<Audio>, soft <Subtitle>) would
// never register. `missedWindow` is true on the first sampled frame after
// such a window: the window's owner then mounts its children *hidden* for that
// one frame, so the markers still land at their exact (sub-frame) times while
// no pixels appear, matching what the sampled video can show.
function missedWindow(clock: Clock, at: number, len: number): boolean {
  if (!(len > 0)) return false; // an empty window is meant to show nothing
  const perMs = clock.fps / 1000;
  const startG = clock.epochMs + at;
  // first sample at or after the window start (tolerating float noise)
  const first = Math.ceil(startG * perMs - 1e-6);
  if (first / perMs < startG + len - 1e-6) return false; // a sample lands inside
  return Math.round((clock.epochMs + clock.ms) * perMs) === first;
}

const hiddenStyle: React.CSSProperties = { display: "none" };

// ---- Cue ----------------------------------------------------------
// Reveal children starting at `at` ms (optionally only for `hold` ms),
// and hand them a LOCAL clock that starts at zero when the cue begins.
// A `hold` shorter than one frame that no frame samples is mounted hidden for
// one frame (see missedWindow), so its <Audio>/<Subtitle> markers still count.
export const Cue: React.FC<{
  at: number;
  hold?: number;
  children: React.ReactNode;
}> = ({ at, hold, children }) => {
  const clock = useClock();
  const inner = (
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
  if (hold != null && missedWindow(clock, at, hold)) return <div style={hiddenStyle}>{inner}</div>;
  if (clock.ms < at) return null;
  if (hold != null && clock.ms >= at + hold) return null;
  return inner;
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
// Dedup and replacement live in createClipRegistry (keyed by clipKey, the same
// identity the parallel-capture merge uses).
const audioMarkers = createClipRegistry();
const audioRegistry: AudioClip[] = audioMarkers.clips;

/** Register a declaration's clip. Pass the key this declaration registered
 *  last (kept in a ref) so a prop change replaces its stale clip. */
function registerAudio(clip: AudioClip, prevKey?: string): string {
  return audioMarkers.register(clip, prevKey);
}

function resetAudio(): void {
  audioMarkers.reset();
}

// ---- subtitle markers ---------------------------------------------
// Like audio: by default a <Subtitle> declares its cues (in reel-global ms)
// instead of drawing pixels, and the renderer reads window.kamishibai.subtitles
// after capture to bake them into a soft mp4 track + a sidecar .srt. Burn mode
// (a global flag the renderer injects) draws pixels instead and registers
// nothing — for full CSS styling, or for GIF output, which has no soft track.
const subtitleRegistry: SubtitleCue[] = [];
const subtitleSeen = new Set<string>();

function registerSubtitleCues(cues: SubtitleCue[]): void {
  for (const c of cues) {
    if (!c.text) continue;
    // A cue that can't play (end <= start) would fail the soft-track mux after
    // the whole capture; drop it here, as burn mode never shows it either.
    if (!isPlayableCue(c)) {
      warnUnplayable(c);
      continue;
    }
    const key = `${c.start}@${c.end}@${c.text}`;
    if (subtitleSeen.has(key)) continue;
    subtitleSeen.add(key);
    subtitleRegistry.push(c);
  }
}

function resetSubtitles(): void {
  subtitleRegistry.length = 0;
  subtitleSeen.clear();
}

/** Whether the renderer asked for burned-in (pixel) captions instead of the
 *  default soft track. Injected on window by serve; false in a plain browser. */
function burnSubtitlesOn(): boolean {
  return typeof window !== "undefined" && !!(window as { __KAMISHIBAI_BURN_SUBTITLES__?: boolean }).__KAMISHIBAI_BURN_SUBTITLES__;
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
  /** auto-dip this clip while any non-ducked clip plays (true = defaults) — for
   *  BGM. A clip without durationMs counts once its file length is probed. */
  duck?: boolean | DuckOptions;
  /** dB volume automation over the clip's timeline (atMs from clip start) */
  gainKeyframes?: Array<{ atMs: number; gain: number }>;
}> = ({ src, atMs, delayMs = 0, gain, trimStartMs, durationMs, fadeInMs, fadeOutMs, loop, duck, gainKeyframes }) => {
  const { epochMs } = useClock();
  const regKey = useRef<string | undefined>(undefined);
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
    regKey.current = registerAudio(clip, regKey.current);
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
  /** dB volume automation (atMs from the clip start, i.e. from this `atMs`) —
   *  manual alternative to duck */
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
// the enclosing <Series> from a layout effect (as settlers do; <Audio> markers
// use a plain effect). So a scene wrapped in your own component works
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

  // <Stage>s directly in this scene claim the exit-fade (see SceneFade).
  const [stageClaims, setStageClaims] = useState(0);
  const claimStage = useCallback(() => {
    setStageClaims((n) => n + 1);
    return () => setStageClaims((n) => n - 1);
  }, []);

  // No placement yet means the registry hasn't settled (first commit) or this
  // scene is outside a Series — render nothing until we know where it lands.
  const place = series?.layout.get(id);
  if (!place) return null;

  const { start, xfIn, xfOut } = place;
  const end = start + durationMs;
  const missed = missedWindow(clock, start, durationMs);
  if (!missed && (clock.ms < start || clock.ms >= end)) return null;
  const local = clock.ms - start;

  // Crossfade: the incoming scene fades in (α = t) over the outgoing one
  // (α = 1 − t), and the incoming layer adds rather than covers
  // (plus-lighter, inside the Series' isolated group). The two weights sum to
  // 1, so the result is a true t-mix of the two scenes — nothing under the
  // Series shows through mid-fade, while transparent scenes still fade out.
  let opacity = 1;
  const fadingIn = xfIn > 0 && local < xfIn;
  if (fadingIn) opacity = Math.min(opacity, local / xfIn);
  if (xfOut > 0 && local >= durationMs - xfOut) {
    opacity = Math.min(opacity, (durationMs - local) / xfOut);
  }

  // Content exit-fade (anti-ghosting): fade this scene's content out so it's
  // gone by the time the next scene starts crossfading in. A <Stage> directly
  // in the scene keeps its `background` and fades only its children, so only
  // the backgrounds blend; without one, the whole scene layer fades.
  const contentOpacity = exitFadeOpacity(place, local);
  const fade: SceneFade | null =
    place.exitFadeMs > 0 ? { opacity: contentOpacity, claim: claimStage } : null;

  const inner = (
    <SceneFadeContext.Provider value={fade}>
      <ClockProvider value={{ ...clock, ms: local, durationMs, epochMs: clock.epochMs + start }}>
        {children}
      </ClockProvider>
    </SceneFadeContext.Provider>
  );

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        opacity,
        ...(fadingIn ? { mixBlendMode: "plus-lighter" as React.CSSProperties["mixBlendMode"] } : null),
        ...(missed ? hiddenStyle : null),
      }}
    >
      {/* Always present when there's an exit-fade, so the subtree never
          remounts when the fade starts. */}
      {place.exitFadeMs > 0 ? (
        <div
          style={{ position: "absolute", inset: 0, opacity: stageClaims > 0 ? 1 : contentOpacity }}
        >
          {inner}
        </div>
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

  // The isolated group gives the crossfade's plus-lighter blend (see
  // SeriesScene) only the Series' own scenes to add to, never what's beneath.
  return (
    <SeriesContext.Provider value={ctx}>
      <div style={{ position: "absolute", inset: 0, isolation: "isolate" }}>
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
      </div>
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

/** Name the component and src in a load failure a settler reports. */
function loadError(component: string, src: string, e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e);
  return new Error(`<${component} src="${src}"> failed to load: ${msg}`);
}

function registerSettler(fn: Settler): () => void {
  settlers.add(fn);
  return () => {
    settlers.delete(fn);
  };
}

// ---- fingerprints -------------------------------------------------
// After each seek, mount() hashes the page's DOM and stylesheets into a
// per-frame fingerprint (see Driver). The DOM captures everything declared in
// JSX — including portals outside the stage, and imperative text/style
// mutations done in a settler, since the hash is taken *after* settlers run.
// What it can't see is a <canvas>'s pixels: they serialize to nothing. So
// anything that paints to a canvas (Video, WebGL, hand-drawn ctx) contributes a
// cheap token here describing what it drew for this ms, and that token folds
// into the frame's fingerprint.
type Fingerprinter = (ms: number) => string;
const fingerprinters = new Set<Fingerprinter>();

function registerFingerprint(fn: Fingerprinter): () => void {
  fingerprinters.add(fn);
  return () => {
    fingerprinters.delete(fn);
  };
}

// The print covers the whole <body> (the stage plus anything portaled or
// appended outside it) and the text of every stylesheet rule, so a CSS edit or
// a portal changes it. Its blind spots: canvas pixels (the fingerprinters fill
// those in), the bytes behind an unchanged URL (an image or font swapped on
// disk), and anything else that paints without touching the DOM or the CSS.
// Elements marked `data-kamishibai-ignore` (e.g. kamishibai/path's hidden
// measuring <svg>) are left out. Tokens are sorted so registration order
// (scenes mounting/unmounting) doesn't perturb an otherwise-identical frame.
function computeFingerprint(host: HTMLElement, ms: number): string {
  const tokens: string[] = [];
  for (const f of fingerprinters) tokens.push(f(ms));
  tokens.sort();
  return fnv1a64(domSnapshot(host) + "\0" + styleSnapshot() + "\0" + tokens.join("\0"));
}

function domSnapshot(host: HTMLElement): string {
  const body = document.body;
  if (!body || !body.contains(host)) return host.innerHTML;
  let html = body.outerHTML;
  for (const el of body.querySelectorAll("[data-kamishibai-ignore]")) {
    html = html.replace(el.outerHTML, "");
  }
  return html;
}

function styleSnapshot(): string {
  const out: string[] = [];
  const sheets = [...document.styleSheets, ...(document.adoptedStyleSheets ?? [])];
  for (const sheet of sheets) {
    if (sheet.disabled) continue;
    try {
      for (const rule of sheet.cssRules) out.push(rule.cssText);
    } catch {
      // Cross-origin sheet: its rules are unreadable, so only its URL counts.
      out.push(`@sheet ${sheet.href ?? ""}`);
    }
  }
  return out.join("\n");
}

/**
 * Contribute a per-frame fingerprint token for content the DOM hash can't see:
 * canvas / WebGL pixels, or asset bytes behind a URL that didn't change (pass
 * e.g. a version or content hash of the file). Pass a stable string, or a
 * function of the global ms that cheaply names what you draw for that ms (e.g.
 * a frame index) — NOT a pixel hash. Frames whose every token (and DOM and CSS)
 * match are treated as identical: within a run the previous still is copied
 * (even without --incremental), and with --incremental a cached PNG is reused.
 * Memoize a function token (useCallback) to avoid re-registering each render.
 */
export function useFingerprint(token: string | Fingerprinter): void {
  useLayoutEffect(() => {
    const fn: Fingerprinter = typeof token === "function" ? token : () => token;
    return registerFingerprint(fn);
  }, [token]);
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
  const audioKey = useRef<string | undefined>(undefined);
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
    audioKey.current = registerAudio(clip, audioKey.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muted, audioPath, epochMs, startMs, durationMs, gain, fadeInMs, fadeOutMs, kfKey]);

  useLayoutEffect(() => {
    const loaded = loadVideoCached(src);
    let video: DecodedVideo | undefined;
    void loaded.then(
      (v) => {
        video = v;
        const c = canvasRef.current;
        if (c) {
          c.width = v.width;
          c.height = v.height;
        }
      },
      () => {}, // a load failure is reported by the settler (it rejects the seek)
    );
    const settler: Settler = async (globalMs) => {
      const v =
        video ??
        (await loaded.catch((e): never => {
          throw loadError("Video", src, e);
        }));
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
    // The canvas pixels are invisible to the DOM hash, so name the shown frame:
    // a clip's pixels at ms are a pure function of (src, frame index), which we
    // read decode-free. By fingerprint time the settler has loaded `video`.
    const fingerprint: Fingerprinter = (globalMs) => {
      const localMs = globalMs - epochRef.current - startMs;
      return video ? `vid:${src}#${video.frameIndexAtMs(localMs)}` : `vid:${src}#pending`;
    };
    const offSettle = registerSettler(settler);
    const offFingerprint = registerFingerprint(fingerprint);
    return () => {
      offSettle();
      offFingerprint();
    };
  }, [src, startMs]);

  return (
    <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block", ...style }} />
  );
};

// ---- Subtitle -----------------------------------------------------
// By DEFAULT captions are a *soft track*, not pixels: <Subtitle> declares its
// cues (in reel-global ms) like <Audio> declares clips, and the renderer bakes
// them into an mp4 mov_text track + a sidecar .srt. They cost no frames, so the
// captured pixels (and their fingerprints) are unaffected by the caption text.
//
// Turn on burn mode globally (render({ burnSubtitles }) / --burn-subtitles) to
// draw captions as pixels instead, with the full CSS styling below — needed for
// GIF output (no soft track) or pixel-perfect styled captions.
//
// Three timing modes, either way: a src file (SRT/VTT), inline `cues`, or static
// string `children` (timed by the enclosing <Cue>/<Series.Scene>). cue times
// count from that scope's start (+ delayMs). A src must be browser-fetchable
// (e.g. --public).
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
  /** distance from the bottom edge, in px (default 80) — burn mode only */
  bottom?: number;
  /** style overrides for the caption text box — burn mode only */
  style?: React.CSSProperties;
}> = ({ src, cues, children, delayMs = 0, bottom = 80, style }) => {
  const { epochMs, durationMs } = useClock();
  const ref = useRef<HTMLDivElement>(null);
  const epochRef = useRef(epochMs);
  epochRef.current = epochMs;
  const durationRef = useRef(durationMs);
  durationRef.current = durationMs;

  const burn = burnSubtitlesOn();
  // src/cues drive the active cue per frame; otherwise children is a static
  // caption (timing comes from the enclosing <Cue>/<Series.Scene>).
  const dynamic = src != null || cues != null;
  const cuesKey = cues ? JSON.stringify(cues) : "";
  const childText = typeof children === "string" ? children : "";

  useLayoutEffect(() => {
    // BURN: draw the active cue's pixels per frame (dynamic only; static text
    // is rendered straight from JSX below).
    if (burn) {
      if (!dynamic) return;
      const pending = cues ? null : loadSubtitlesCached(src!);
      let resolved: SubtitleCue[] | undefined = cues ?? undefined;
      // A load failure is reported by the settler (it rejects the seek).
      if (pending) void pending.then((c) => (resolved = c), () => {});
      const settler: Settler = async (globalMs) => {
        const cs =
          resolved ??
          (await pending!.catch((e): never => {
            throw loadError("Subtitle", src!, e);
          }));
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
    }

    // SOFT (default): register cues in reel-global ms for the muxer. No cleanup —
    // markers are read once after capture (dedup makes re-registration safe).
    const place = (cs: SubtitleCue[]) =>
      registerSubtitleCues(
        cs.map((c) => ({
          start: epochRef.current + delayMs + c.start,
          end: epochRef.current + delayMs + c.end,
          text: c.text,
        })),
      );
    if (cues) place(cues);
    else if (src) void loadSubtitlesCached(src).then(place);
    else if (childText) {
      // Static caption: spans the enclosing scope (epoch .. epoch + duration),
      // exactly the window burn mode draws it in — delayMs is for src / cues.
      registerSubtitleCues([
        {
          start: epochRef.current,
          end: epochRef.current + durationRef.current,
          text: childText,
        },
      ]);
    } else if (children) {
      console.warn(
        "kamishibai: <Subtitle> with non-string children can't be a soft caption — " +
          "use string text, or render with burnSubtitles for styled JSX captions.",
      );
    }
  }, [burn, dynamic, src, cuesKey, delayMs, childText]);

  // SOFT mode draws nothing — it's a marker, like <Audio>.
  if (!burn) return null;

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
// it plays from the scene start (+ delayMs), or at an absolute atMs, trimmed
// to its own length. With `subtitle`, the same text is also a caption for the
// clip's window — a soft track by default, burned in with --burn-subtitles —
// text → voice → caption, all from one source. No new mux path; it rides the
// existing <Audio> + <Subtitle> machinery.
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
  /** also caption the narration text for the clip's window (soft track by
   *  default; pixels with --burn-subtitles) */
  subtitle?: boolean;
  /** caption distance from the bottom edge, in px (default 80) — burn mode only */
  subtitleBottom?: number;
  /** caption style overrides — burn mode only */
  subtitleStyle?: React.CSSProperties;
}> = ({ clip, atMs, delayMs = 0, gain, fadeInMs, fadeOutMs, subtitle, subtitleBottom, subtitleStyle }) => {
  const { epochMs } = useClock();
  // The caption's <Cue> is scope-relative, so turn an absolute atMs into an
  // offset from this scope's start — it must land where the audio does.
  const captionAt = atMs != null ? atMs - epochMs : delayMs;
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
        <Cue at={captionAt} hold={clip.durationMs}>
          <Subtitle bottom={subtitleBottom} style={subtitleStyle}>
            {clip.text}
          </Subtitle>
        </Cue>
      ) : null}
    </>
  );
};

/**
 * Play a sequence of clips laid out by narrationScene / narrationSequence:
 * one <Narration> per step at its `atMs`, optionally captioned. Pair it with
 * `<Cue at={step.atMs}>` to reveal content as each line starts.
 */
export const NarrationSteps: React.FC<{
  /** steps from narrationScene(...).steps or narrationSequence(...) */
  steps: NarrationStep[];
  /** volume in dB for every clip */
  gain?: number;
  /** also caption each clip for its own window (soft track by default) */
  subtitle?: boolean;
  /** caption distance from the bottom edge, in px (default 80) — burn mode only */
  subtitleBottom?: number;
  /** caption style overrides — burn mode only */
  subtitleStyle?: React.CSSProperties;
}> = ({ steps, gain, subtitle, subtitleBottom, subtitleStyle }) => (
  <>
    {steps.map((s, i) => (
      <Narration
        key={i}
        clip={s.clip}
        delayMs={s.atMs}
        gain={gain}
        subtitle={subtitle}
        subtitleBottom={subtitleBottom}
        subtitleStyle={subtitleStyle}
      />
    ))}
  </>
);

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
  /** the mount host whose committed DOM is hashed into each frame's print */
  host: HTMLElement;
}> = ({ scene, meta, livePreview, host }) => {
  const [ms, setMs] = useState(0);
  const [driven, setDriven] = useState(false);

  useEffect(() => {
    // The seek hook resolves after a settled paint (double rAF). The live
    // `audioRegistry` array is exposed so the renderer can read markers that
    // <Audio> components push as the tree mounts across the timeline.
    window.kamishibai = {
      meta,
      seek: (target: number) =>
        new Promise<string>((resolve, reject) => {
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
          // for this ms and wait for *all* of them, then settle the paint
          // (rAF) before resolving. A failed settler (a video that won't
          // decode, a caption file that won't load) rejects the seek, so the
          // capture fails loudly instead of shooting a blank frame.
          requestAnimationFrame(() => {
            void Promise.allSettled([...settlers].map(async (s) => s(target))).then((results) => {
              const errors = results
                .filter((r): r is PromiseRejectedResult => r.status === "rejected")
                .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)));
              if (errors.length > 0) {
                reject(new Error(`kamishibai: seek(${target}) failed: ${errors.join("; ")}`));
                return;
              }
              requestAnimationFrame(() =>
                // Fingerprint *after* the settled paint, so a settler's
                // imperative DOM writes (e.g. <Subtitle> text) are included.
                requestAnimationFrame(() => resolve(computeFingerprint(host, target))),
              );
            });
          });
        }),
      audio: audioRegistry,
      subtitles: subtitleRegistry,
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
  resetSubtitles();
  const host =
    options.container ?? document.getElementById("kamishibai-root") ?? document.body;
  const stage = document.createElement("div");
  stage.style.cssText =
    `position:absolute;top:0;left:0;width:${meta.width}px;height:${meta.height}px;overflow:hidden;`;
  host.appendChild(stage);
  createRoot(stage).render(
    <Driver scene={scene} meta={meta} livePreview={options.livePreview ?? true} host={stage} />,
  );
}

export type { KamishibaiMeta } from "../protocol.ts";
