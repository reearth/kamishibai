// The dev player: drives the reel in an <iframe> through seek(ms) alone.
// ------------------------------------------------------------------
// Runs in the browser at /__kamishibai/ (see server.ts). The reel is loaded
// from the root, where a render loads it too, and every picture comes from
// the same call the renderer makes, so the preview needs nothing from the
// page beyond the contract. Unlike capture, playback runs on the wall clock
// and skips frames a slow seek can't keep up with.
//
// Sound comes from the markers the page declares (window.kamishibai.audio /
// .subtitles), which register as the timeline is seeked. A second, invisible
// copy of the reel sweeps every frame in the background to collect them all;
// until it finishes, only the ones seen so far play.
//
// What seek(ms) returns is shown too: for each frame, whether a render would
// capture it or copy the previous still (seek returned false, or the same
// fingerprint as the frame before). The sweep fills this in for every frame.
// ------------------------------------------------------------------
import { frameCount, frameTimeMs, type KamishibaiMeta, type KamishibaiPage } from "../protocol.ts";
import { applyDucking, clipKey, type AudioClip } from "../audio.ts";
import type { Cue } from "../subtitle.ts";

/** What the overlay shows: nothing; the soft subtitles; or, on top of those,
 *  every sound as text (a storyboard). */
type Cc = "off" | "captions" | "storyboard";
const CC_MODES: Cc[] = ["off", "captions", "storyboard"];

interface Config {
  page: string;
  entry: string;
  /** --mute, or null when it wasn't given */
  mute: boolean | null;
  /** --cc, or null when it wasn't given */
  cc: Cc | null;
  sweep: boolean;
}

const PREFIX = "/__kamishibai/";
const MUTE_KEY = "kamishibai.dev.mute";
const CC_KEY = "kamishibai.dev.cc";
const LABELS_KEY = "kamishibai.dev.laneLabels";
/** how long a clip of unknown length stays on the storyboard */
const UNKNOWN_CLIP_MS = 1500;

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const ui = {
  entry: el("entry"),
  state: el("state"),
  sweepState: el("sweepState"),
  pending: el("pending"),
  mute: el<HTMLButtonElement>("mute"),
  cc: el<HTMLButtonElement>("cc"),
  viewport: el("viewport"),
  frame: el("frame"),
  chips: el("chips"),
  caption: el("caption"),
  error: el("error"),
  track: el("track"),
  laneAudio: el("laneAudio"),
  laneCues: el("laneCues"),
  laneTime: el("laneTime"),
  range: el("range"),
  head: el("head"),
  play: el<HTMLButtonElement>("play"),
  loop: el<HTMLButtonElement>("loop"),
  clock: el("clock"),
  frameNo: el("frameNo"),
  copied: el("copied"),
  help: el("help"),
  laneLabels: el<HTMLInputElement>("laneLabels"),
  laneFrames: el<HTMLCanvasElement>("laneFrames"),
  overview: el("overview"),
  thumb: el("thumb"),
  seekInfo: el("seekInfo"),
  frameStats: el("frameStats"),
  helpButton: el<HTMLButtonElement>("helpButton"),
};

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private window or blocked storage: the setting just isn't remembered */
  }
}
const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---- state ----------------------------------------------------------

let cfg: Config;
/** bumped on every (re)load; async work from an older load checks it and stops */
let generation = 0;
let reelEl: HTMLIFrameElement | undefined;
let sweepEl: HTMLIFrameElement | undefined;
let page: KamishibaiPage | undefined;
let meta: KamishibaiMeta | undefined;
let total = 0;
let frame = 0;
let playing = false;
let loop = false;
let range: { a: number; b: number } | null = null;
let muted = false;
let cc: Cc = "captions";
const clips = new Map<string, AudioClip>();
const cues = new Map<string, Cue>();

/** What seek returned for a frame, as the renderer reads it. */
type SeekResult = { kind: "capture" } | { kind: "same" } | { kind: "print"; print: string };
const results = new Map<number, SeekResult>();
/** The part of the reel the timeline shows, in ms (zoomed in when span is
 *  less than the reel). */
const view = { start: 0, span: 0 };
/** the narrowest view: this many frames across the track */
const MIN_VIEW_FRAMES = 12;

/** the frame the visible reel was seeked to last, so its `false` can be placed */
let lastSeeked = -1;

function toResult(ret: unknown): SeekResult {
  if (ret === false) return { kind: "same" };
  if (typeof ret === "string") return { kind: "print", print: ret };
  return { kind: "capture" };
}

/** Record frame `f`'s result. A `false` means "same as the frame seeked just
 *  before", so it only says something about `f` when that was `f - 1`. */
function record(f: number, ret: unknown, prev: number): void {
  const r = toResult(ret);
  if (r.kind === "same" && prev !== f - 1) return;
  results.set(f, r);
  framesDirty = true;
}

/** Whether a render would copy frame `f` from `f - 1` instead of capturing
 *  it; undefined while that isn't known yet. */
function copied(f: number): boolean | undefined {
  const r = results.get(f);
  if (!r) return undefined;
  if (f === 0) return false;
  if (r.kind === "same") return true;
  if (r.kind === "capture") return false;
  const before = results.get(f - 1);
  if (!before) return undefined;
  return before.kind === "print" && before.print === r.print;
}

const fps = () => meta!.fps;
const msOf = (f: number) => frameTimeMs(f, fps());

// ---- loading the reel -----------------------------------------------

function makeFrame(id: string): HTMLIFrameElement {
  const f = document.createElement("iframe");
  f.id = id;
  f.src = cfg.page;
  return f;
}

/** Resolve with the page's window.kamishibai once it's there. */
function waitForPage(f: HTMLIFrameElement, gen: number): Promise<KamishibaiPage> {
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (gen !== generation) return reject(new Error("stale"));
      const k = (f.contentWindow as (Window & { kamishibai?: KamishibaiPage }) | null)?.kamishibai;
      if (k && k.meta && typeof k.seek === "function") resolve(k);
      else setTimeout(poll, 50);
    };
    poll();
  });
}

async function load(): Promise<void> {
  const gen = ++generation;
  pause();
  hideError();
  clips.clear();
  cues.clear();
  results.clear();
  lastSeeked = -1;
  framesDirty = true;
  buffers.clear();
  unplayable.clear();
  page = undefined;
  setState("loading…");
  ui.sweepState.textContent = "";

  reelEl?.remove();
  sweepEl?.remove();
  sweepEl = undefined;
  reelEl = makeFrame("reel");
  ui.frame.prepend(reelEl);

  let k: KamishibaiPage;
  try {
    k = await waitForPage(reelEl, gen);
  } catch {
    return; // a newer load took over
  }
  page = k;
  meta = k.meta;
  total = Math.max(1, frameCount(meta));
  frame = Math.min(frame, total - 1);
  if (range) range = { a: Math.min(range.a, total - 1), b: Math.min(range.b, total - 1) };
  setState(`${meta.width}×${meta.height} · ${meta.fps} fps · ${(meta.durationMs / 1000).toFixed(2)} s`);
  layout();
  // Keep the zoom across a reload; the reel may have changed length.
  setView(view.start, view.span || meta.durationMs);
  show(frame);
  update();
  if (cfg.sweep) void sweep(gen);
}

/** Seek a hidden copy of the reel through every frame to collect its markers. */
async function sweep(gen: number): Promise<void> {
  const f = makeFrame("sweep");
  f.width = String(meta!.width);
  f.height = String(meta!.height);
  document.body.append(f);
  sweepEl = f;
  let k: KamishibaiPage;
  try {
    k = await waitForPage(f, gen);
  } catch {
    return;
  }
  for (let i = 0; i < total; i++) {
    if (gen !== generation) return;
    try {
      record(i, await k.seek(msOf(i)), i - 1);
    } catch {
      /* the visible reel reports seek errors */
    }
    if (i % 10 === 0) {
      collect(k);
      drawFrames();
      ui.sweepState.textContent = `sweeping ${i + 1}/${total}`;
    }
  }
  collect(k);
  drawFrames();
  ui.sweepState.textContent = "";
  update();
  f.remove();
  if (sweepEl === f) sweepEl = undefined;
}

// ---- seeking ----------------------------------------------------------

let seeking = false;
let wanted: number | null = null;

/** Show frame `f`. Seeks run one at a time; while one is in flight only the
 *  latest request is kept, so a slow reel skips frames instead of lagging. */
function show(f: number): void {
  wanted = f;
  if (!seeking) void pump();
}

async function pump(): Promise<void> {
  seeking = true;
  const gen = generation;
  try {
    while (wanted !== null && gen === generation && page) {
      const f = wanted;
      wanted = null;
      try {
        record(f, await page.seek(msOf(f)), lastSeeked);
      } catch (e) {
        showError(`seek(${msOf(f)}) failed: ${errorMessage(e)}`);
      }
      lastSeeked = f;
      collect(page);
      drawFrames();
      seekInfo();
    }
  } finally {
    seeking = false;
  }
}

/** Merge the markers a page has registered so far. */
function collect(k: KamishibaiPage): void {
  const added: AudioClip[] = [];
  for (const c of k.audio ?? []) {
    const key = clipKey(c);
    if (!clips.has(key)) {
      const copy = { ...c };
      clips.set(key, copy);
      added.push(copy);
    }
  }
  let newCues = false;
  for (const c of k.subtitles ?? []) {
    const key = `${c.start}@${c.end}@${c.text}`;
    if (!cues.has(key)) {
      cues.set(key, { ...c });
      newCues = true;
    }
  }
  if (added.length > 0 || newCues) {
    drawLanes();
    updatePending();
    overlay();
  }
  if (added.length > 0 && playing && !muted) scheduleAudio();
}

// ---- playback ---------------------------------------------------------

let ac: AudioContext | undefined;
/** the AudioContext time and reel ms playback was (re)started at */
let t0Ctx = 0;
let t0Ms = 0;
let raf = 0;
let session = 0;
const sources: AudioScheduledSourceNode[] = [];
const scheduled = new Set<string>();
const buffers = new Map<string, Promise<AudioBuffer | null>>();
/** srcs that failed to load or decode (details in the console) */
const unplayable = new Set<string>();

const clockMs = () => t0Ms + (ac!.currentTime - t0Ctx) * 1000;

function bounds(): [number, number] {
  return range ? [range.a, range.b] : [0, total - 1];
}

function play(): void {
  if (!meta) return;
  ac ??= new AudioContext();
  void ac.resume();
  const [lo, hi] = bounds();
  if (frame < lo || frame >= hi) frame = lo;
  playing = true;
  restartAt(msOf(frame));
  raf = requestAnimationFrame(tick);
  update();
}

function pause(): void {
  playing = false;
  cancelAnimationFrame(raf);
  stopAudio();
  update();
}

function restartAt(ms: number): void {
  t0Ctx = ac!.currentTime;
  t0Ms = ms;
  stopAudio();
  if (!muted) scheduleAudio();
}

function tick(): void {
  if (!playing) return;
  const [lo, hi] = bounds();
  let f = Math.floor((clockMs() * fps()) / 1000 + 1e-6);
  if (f > hi) {
    if (loop) {
      f = lo;
      restartAt(msOf(lo));
    } else {
      frame = hi;
      show(frame);
      pause();
      return;
    }
  }
  if (f !== frame) {
    frame = f;
    show(f);
    reveal(msOf(f)); // page the timeline along with the playhead
    update();
  }
  raf = requestAnimationFrame(tick);
}

function stopAudio(): void {
  session++;
  scheduled.clear();
  for (const s of sources.splice(0)) {
    try {
      s.stop();
    } catch {
      /* not started yet */
    }
  }
}

function buffer(src: string): Promise<AudioBuffer | null> {
  let p = buffers.get(src);
  if (!p) {
    p = fetch(`${PREFIX}file?src=${encodeURIComponent(src)}`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((b) => ac!.decodeAudioData(b))
      .catch((e) => {
        console.warn(`kamishibai dev: can't play ${src}: ${errorMessage(e)}`);
        unplayable.add(src);
        updatePending();
        return null;
      });
    buffers.set(src, p);
  }
  return p;
}

/** Schedule every known clip not yet scheduled in this playback session. */
function scheduleAudio(): void {
  const s = session;
  const playable = [...clips.values()].filter((c) => c.src !== "");
  void Promise.all(playable.map((c) => buffer(c.src))).then((bufs) => {
    if (s !== session || !playing || muted) return;
    const sourceMs = new Map<string, number>();
    playable.forEach((c, i) => {
      const b = bufs[i];
      if (b) sourceMs.set(c.src, b.duration * 1000);
    });
    // Duck as the mux would, over every clip known now.
    const mixed = applyDucking(playable, { reelMs: meta!.durationMs, sourceMs });
    const now = clockMs();
    mixed.forEach((c, i) => {
      const key = clipKey(playable[i]!);
      const b = bufs[i];
      if (!b || scheduled.has(key)) return;
      scheduled.add(key);
      scheduleClip(c, b, now);
    });
  });
}

/** dB at `ms` along linearly interpolated keyframes (held flat outside them). */
function keyframeDb(kf: Array<{ atMs: number; gain: number }>, ms: number): number {
  if (kf.length === 0) return 0;
  if (ms <= kf[0]!.atMs) return kf[0]!.gain;
  for (let i = 1; i < kf.length; i++) {
    const a = kf[i - 1]!;
    const b = kf[i]!;
    if (ms <= b.atMs) return b.atMs === a.atMs ? b.gain : a.gain + ((b.gain - a.gain) * (ms - a.atMs)) / (b.atMs - a.atMs);
  }
  return kf[kf.length - 1]!.gain;
}

function clipLength(c: AudioClip, sourceMs: number | undefined): number | undefined {
  const rest = sourceMs != null ? Math.max(0, sourceMs - (c.trimStartMs ?? 0)) : undefined;
  if (c.loop) return c.durationMs ?? meta!.durationMs - c.atMs;
  if (c.durationMs != null) return rest != null ? Math.min(c.durationMs, rest) : c.durationMs;
  return rest;
}

function scheduleClip(c: AudioClip, buf: AudioBuffer, nowMs: number): void {
  const a = ac!;
  const trim = c.trimStartMs ?? 0;
  const len = clipLength(c, buf.duration * 1000)!;
  const end = Math.min(c.atMs + len, meta!.durationMs);
  if (end <= nowMs) return;
  const startMs = Math.max(c.atMs, nowMs);
  const local = startMs - c.atMs;
  const when = a.currentTime + (startMs - nowMs) / 1000;

  const node = a.createBufferSource();
  node.buffer = buf;
  let offsetMs = trim + local;
  if (c.loop) {
    node.loop = true;
    node.loopStart = trim / 1000;
    node.loopEnd = buf.duration;
    const loopLen = buf.duration * 1000 - trim;
    offsetMs = trim + (loopLen > 0 ? local % loopLen : 0);
  }

  // The level over the clip's own time: gain + keyframes in dB, times the fades.
  const kf = c.gainKeyframes ?? [];
  const level = (ms: number) => {
    let v = 10 ** (((c.gain ?? 0) + keyframeDb(kf, ms)) / 20);
    if (c.fadeInMs && ms < c.fadeInMs) v *= ms / c.fadeInMs;
    if (c.fadeOutMs && ms > len - c.fadeOutMs) v *= Math.max(0, (len - ms) / c.fadeOutMs);
    return v;
  };
  const points = [
    ...kf.map((k) => k.atMs),
    c.fadeInMs ?? 0,
    c.fadeOutMs ? len - c.fadeOutMs : 0,
    len,
  ]
    .filter((p) => p > local && p <= len)
    .sort((x, y) => x - y);
  const g = a.createGain();
  g.gain.setValueAtTime(level(local), when);
  for (const p of points) g.gain.linearRampToValueAtTime(level(p), when + (p - local) / 1000);

  node.connect(g).connect(a.destination);
  node.start(when, offsetMs / 1000);
  node.stop(when + (end - startMs) / 1000);
  sources.push(node);
}

// ---- drawing ----------------------------------------------------------

function layout(): void {
  if (!meta || !reelEl) return;
  const box = ui.viewport.getBoundingClientRect();
  const s = Math.min((box.width - 32) / meta.width, (box.height - 32) / meta.height);
  const scale = Math.max(0.05, s);
  reelEl.width = String(meta.width);
  reelEl.height = String(meta.height);
  reelEl.style.transform = `scale(${scale})`;
  ui.frame.style.width = `${meta.width * scale}px`;
  ui.frame.style.height = `${meta.height * scale}px`;
}

/** Where `ms` falls across the track, as a CSS percentage (off the track
 *  when it's outside the view; the track clips it). */
const pos = (ms: number) => `${((ms - view.start) / view.span) * 100}%`;
/** How wide a stretch of `ms` is on the track. */
const wid = (ms: number) => `${(ms / view.span) * 100}%`;

function setView(start: number, span: number): void {
  if (!meta) return;
  const d = meta.durationMs;
  view.span = Math.max(Math.min(d, (MIN_VIEW_FRAMES * 1000) / fps()), Math.min(d, span));
  view.start = Math.max(0, Math.min(d - view.span, start));
  drawLanes();
  drawTicks();
  framesDirty = true;
  drawFrames();
  drawOverview();
  update();
}

/** Zoom by `factor` (< 1 zooms in), keeping `anchorMs` where it is. */
function zoom(factor: number, anchorMs = msOf(frame)): void {
  const x = (anchorMs - view.start) / view.span;
  const span = view.span * factor;
  setView(anchorMs - x * span, span);
}

/** Scroll the view so `ms` is on it. */
function reveal(ms: number): void {
  if (ms < view.start || ms > view.start + view.span) setView(ms - view.span * 0.05, view.span);
}

function drawOverview(): void {
  const zoomed = !!meta && view.span < meta.durationMs;
  ui.overview.hidden = !zoomed;
  if (!zoomed) return;
  ui.thumb.style.left = `${(view.start / meta!.durationMs) * 100}%`;
  ui.thumb.style.width = `${(view.span / meta!.durationMs) * 100}%`;
}

function isVoice(c: AudioClip): boolean {
  return c.src === "" || c.label != null;
}

function drawLanes(): void {
  if (!meta) return;
  ui.laneAudio.replaceChildren();
  ui.laneCues.replaceChildren();
  // Clips that overlap in time go on separate rows: each takes the first row
  // that's free by its start.
  const rowEnds: number[] = [];
  const sorted = [...clips.values()].sort((a, b) => a.atMs - b.atMs);
  for (const c of sorted) {
    const len = Math.min(clipLength(c, undefined) ?? UNKNOWN_CLIP_MS, meta.durationMs - c.atMs);
    let row = rowEnds.findIndex((end) => end <= c.atMs);
    if (row < 0) row = rowEnds.length;
    rowEnds[row] = c.atMs + len;
    const bar = document.createElement("div");
    bar.className = `bar${isVoice(c) ? " voice" : ""}${c.src === "" ? " placeholder" : ""}`;
    bar.style.left = pos(c.atMs);
    bar.style.width = wid(len);
    bar.style.top = `${2 + row * 10}px`;
    bar.title = describe(c);
    ui.laneAudio.append(bar);
  }
  el("timeline").style.setProperty("--audio-rows", String(Math.max(1, rowEnds.length)));
  for (const c of cues.values()) {
    const bar = document.createElement("div");
    bar.className = "bar cue";
    bar.style.left = pos(c.start);
    bar.style.width = wid(c.end - c.start);
    bar.title = c.text;
    ui.laneCues.append(bar);
  }
}

let framesDirty = true;

/** The frames lane: a mark for every frame a render would capture. */
function drawFrames(): void {
  if (!meta || !framesDirty) return;
  framesDirty = false;
  const canvas = ui.laneFrames;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const dpr = devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const g = canvas.getContext("2d")!;
  g.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement);
  const colors = { capture: css.getPropertyValue("--accent"), copy: css.getPropertyValue("--line") };
  const px = (1000 / fps() / view.span) * w; // one frame's width
  // Zoomed in far enough, frames get a gap so each one can be told apart.
  const gap = px >= 5 ? 1 : 0;
  const first = Math.max(0, Math.floor((view.start * fps()) / 1000));
  const last = Math.min(total - 1, Math.ceil(((view.start + view.span) * fps()) / 1000));
  for (let f = first; f <= last; f++) {
    const c = copied(f);
    if (c === undefined) continue;
    g.fillStyle = c ? colors.copy : colors.capture;
    // Each cell runs to where the next frame starts (both rounded the same
    // way, so every gap lands), and is at least a pixel wide, so a lone
    // captured frame in a long reel still shows.
    const x0 = Math.round(((msOf(f) - view.start) / view.span) * w);
    const x1 = Math.round(((msOf(f + 1) - view.start) / view.span) * w);
    g.fillRect(x0, 0, Math.max(1, x1 - x0 - gap), h);
  }
}

/** The readout for the current frame: what seek returned, and what a render
 *  would do with it. */
function seekInfo(): void {
  const r = results.get(frame);
  const c = copied(frame);
  // The fingerprint (or false), then what a render does: "capture" or "copy".
  const value = !r || r.kind === "capture" ? "" : r.kind === "same" ? "false" : r.print.slice(0, 16);
  const fate = c === undefined ? "" : c ? "copy" : "capture";
  ui.seekInfo.textContent = [value, fate].filter(Boolean).join(" · ");
  ui.seekInfo.title = r?.kind === "print" ? r.print : "";

  const known = [...Array(total).keys()].map(copied);
  ui.frameStats.textContent = known.every((k) => k !== undefined)
    ? `renders ${known.filter((k) => !k).length} of ${total} frames`
    : "";
}

function drawTicks(): void {
  if (!meta) return;
  ui.laneTime.replaceChildren();
  // About one label per 90px, on a round step.
  const most = Math.max(2, ui.track.clientWidth / 90);
  const steps = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];
  const step = (steps.find((s) => view.span / 1000 / s <= most) ?? 3600) * 1000;
  const end = view.start + view.span;
  for (let i = Math.ceil(view.start / step); i * step <= end; i++) {
    const t = i * step;
    // None too near the right edge: its label would hang off the track.
    if ((t - view.start) / view.span > 0.96) break;
    const tick = document.createElement("div");
    tick.className = "tick";
    tick.style.left = pos(t);
    const label = document.createElement("span");
    label.textContent = formatTime(t, step < 1000);
    tick.append(label);
    ui.laneTime.append(tick);
  }
}

function describe(c: AudioClip): string {
  if (c.src === "") return `voice (no audio yet): ${c.label ?? ""}`;
  const name = c.src.split(/[\\/]/).pop() ?? c.src;
  return c.label != null ? `voice: ${c.label}` : name;
}

/** The storyboard chips and the caption for the current frame. */
function overlay(): void {
  if (!meta) return;
  const t = msOf(frame);
  const cue = cc !== "off" ? [...cues.values()].find((c) => c.start <= t && t < c.end) : undefined;
  ui.caption.textContent = cue?.text ?? "";

  // Only the storyboard lists the sounds; captions mode is the subtitles alone.
  ui.chips.replaceChildren();
  if (cc !== "storyboard") return;
  for (const c of clips.values()) {
    const len = clipLength(c, undefined) ?? UNKNOWN_CLIP_MS;
    if (!(c.atMs <= t && t < c.atMs + len)) continue;
    // A line already on screen as the caption is named without its text.
    const captioned = !!cue && c.label === cue.text;
    const chip = document.createElement("div");
    chip.className = `chip${isVoice(c) ? " voice" : ""}`;
    const kind = document.createElement("span");
    kind.className = "kind";
    kind.textContent =
      (c.src === "" ? "voice · not synthesized" : isVoice(c) ? "voice" : "sound") + (captioned ? " · captioned" : "");
    chip.append(kind);
    if (!captioned) chip.append(c.label ?? describe(c));
    ui.chips.append(chip);
  }
}

function formatTime(ms: number, withMs = true): string {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const base = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return withMs ? `${base}.${String(Math.floor(ms % 1000)).padStart(3, "0")}` : base;
}

function update(): void {
  ui.play.textContent = playing ? "⏸" : "▶︎";
  ui.loop.setAttribute("aria-pressed", String(loop));
  ui.mute.textContent = muted ? "🔇 Muted" : "🔊 Sound";
  ui.mute.setAttribute("aria-pressed", String(muted));
  ui.cc.textContent = `CC: ${cc}`;
  ui.cc.setAttribute("aria-pressed", String(cc !== "off"));
  if (!meta) return;
  ui.clock.textContent = formatTime(msOf(frame));
  ui.frameNo.textContent = `frame ${frame} / ${total - 1}`;
  seekInfo();
  ui.head.style.left = pos(msOf(frame));
  if (range) {
    ui.range.hidden = false;
    ui.range.style.left = pos(msOf(range.a));
    ui.range.style.width = wid(msOf(range.b + 1) - msOf(range.a));
  } else {
    ui.range.hidden = true;
  }
  overlay();
}

function updatePending(): void {
  const n = [...clips.values()].filter((c) => c.src === "").length;
  const notes: string[] = [];
  if (n > 0) notes.push(`${n} line(s) not synthesized — kamishibai tts ${cfg.entry}`);
  if (unplayable.size > 0) notes.push(`${unplayable.size} sound(s) can't play (see the console)`);
  ui.pending.textContent = notes.join(" · ");
  ui.pending.title = ui.pending.textContent;
}

function setState(s: string): void {
  ui.state.textContent = s;
}

const seenErrors = new Set<string>();
function showError(message: string): void {
  if (seenErrors.has(message)) return;
  seenErrors.add(message);
  ui.error.hidden = false;
  ui.error.textContent = ui.error.textContent ? `${ui.error.textContent}\n\n${message}` : message;
}
function hideError(): void {
  seenErrors.clear();
  ui.error.hidden = true;
  ui.error.textContent = "";
}

// ---- controls ---------------------------------------------------------

function goto(f: number): void {
  if (!meta) return;
  frame = Math.max(0, Math.min(total - 1, f));
  show(frame);
  if (playing) restartAt(msOf(frame));
  reveal(msOf(frame));
  update();
}

const helpOpen = () => !ui.help.hasAttribute("hidden");

function setHelp(open: boolean): void {
  ui.help.hidden = !open;
  ui.helpButton.setAttribute("aria-expanded", String(open));
}

function toggleMute(): void {
  muted = !muted;
  storageSet(MUTE_KEY, String(muted));
  if (playing) restartAt(clockMs());
  update();
}

function cycleCc(): void {
  cc = CC_MODES[(CC_MODES.indexOf(cc) + 1) % CC_MODES.length]!;
  storageSet(CC_KEY, cc);
  update();
}

function setIn(): void {
  range = { a: frame, b: range && range.b >= frame ? range.b : total - 1 };
  update();
}
function setOut(): void {
  range = { a: range && range.a <= frame ? range.a : 0, b: frame };
  update();
}

async function copyOnly(): Promise<void> {
  const r = range ?? { a: frame, b: frame };
  const flag = `--only ${r.a === r.b ? r.a : `${r.a}-${r.b}`}`;
  try {
    await navigator.clipboard.writeText(flag);
    ui.copied.textContent = `copied: ${flag}`;
  } catch {
    ui.copied.textContent = flag; // no clipboard access: show it to copy by hand
  }
  setTimeout(() => (ui.copied.textContent = ""), 2500);
}

function bind(): void {
  const on = (id: string, fn: () => void) => el(id).addEventListener("click", fn);
  on("play", () => (playing ? pause() : play()));
  on("start", () => goto(range ? range.a : 0));
  on("end", () => goto(range ? range.b : total - 1));
  on("prev", () => goto(frame - 1));
  on("next", () => goto(frame + 1));
  on("in", setIn);
  on("out", setOut);
  on("clear", () => ((range = null), update()));
  on("loop", () => ((loop = !loop), update()));
  on("copy", () => void copyOnly());
  on("helpButton", () => setHelp(!helpOpen()));
  // A click anywhere else closes the help.
  addEventListener("pointerdown", (e) => {
    if (helpOpen() && !ui.help.contains(e.target as Node) && e.target !== ui.helpButton) setHelp(false);
  });
  // Lane names, for people still learning the timeline; off once familiar.
  const showLabels = (on: boolean) => {
    ui.laneLabels.checked = on;
    ui.track.classList.toggle("no-labels", !on);
  };
  showLabels(storageGet(LABELS_KEY) !== "false");
  ui.laneLabels.addEventListener("change", () => {
    storageSet(LABELS_KEY, String(ui.laneLabels.checked));
    showLabels(ui.laneLabels.checked);
  });
  on("mute", toggleMute);
  on("cc", cycleCc);

  // Scrub: press anywhere on the track and drag.
  const scrub = (e: PointerEvent) => {
    if (!meta) return;
    const box = ui.track.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - box.left) / box.width));
    goto(Math.round(((view.start + x * view.span) / 1000) * fps()));
  };

  // Wheel: ⌘/Ctrl + wheel (or a trackpad pinch) zooms at the pointer;
  // otherwise the wheel, or a sideways swipe, scrolls.
  ui.track.addEventListener(
    "wheel",
    (e) => {
      if (!meta) return;
      e.preventDefault();
      const box = ui.track.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const x = (e.clientX - box.left) / box.width;
        zoom(Math.exp(e.deltaY * 0.01), view.start + x * view.span);
      } else {
        const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        setView(view.start + (d / box.width) * view.span, view.span);
      }
    },
    { passive: false },
  );
  on("zoomIn", () => zoom(0.5));
  on("zoomOut", () => zoom(2));
  on("zoomFit", () => setView(0, meta ? meta.durationMs : 0));

  // The overview bar under a zoomed timeline: drag the window, or press
  // beside it to center the view there.
  let grab: number | null = null;
  const at = (e: PointerEvent) => {
    const box = ui.overview.getBoundingClientRect();
    return ((e.clientX - box.left) / box.width) * meta!.durationMs;
  };
  ui.overview.addEventListener("pointerdown", (e) => {
    if (!meta) return;
    ui.overview.setPointerCapture(e.pointerId);
    const ms = at(e);
    grab = e.target === ui.thumb ? ms - view.start : view.span / 2;
    setView(ms - grab, view.span);
  });
  ui.overview.addEventListener("pointermove", (e) => {
    if (grab !== null && ui.overview.hasPointerCapture(e.pointerId)) setView(at(e) - grab, view.span);
  });
  ui.overview.addEventListener("pointerup", () => (grab = null));
  ui.track.addEventListener("pointerdown", (e) => {
    ui.track.setPointerCapture(e.pointerId);
    scrub(e);
  });
  ui.track.addEventListener("pointermove", (e) => {
    if (ui.track.hasPointerCapture(e.pointerId)) scrub(e);
  });

  addEventListener("keydown", (e) => {
    // Leave keys to a focused control (Space toggles the help's checkbox).
    if (e.metaKey || e.ctrlKey || e.altKey || e.target instanceof HTMLInputElement) return;
    const jump = e.shiftKey && meta ? Math.round(fps()) : 1;
    const keys: Record<string, () => void> = {
      " ": () => (playing ? pause() : play()),
      ArrowLeft: () => goto(frame - jump),
      ArrowRight: () => goto(frame + jump),
      Home: () => goto(range ? range.a : 0),
      End: () => goto(range ? range.b : total - 1),
      i: setIn,
      o: setOut,
      Escape: () => (helpOpen() ? setHelp(false) : ((range = null), update())),
      "?": () => setHelp(!helpOpen()),
      l: () => ((loop = !loop), update()),
      c: cycleCc,
      m: toggleMute,
      "+": () => zoom(0.5),
      "=": () => zoom(0.5),
      "-": () => zoom(2),
      "0": () => setView(0, meta ? meta.durationMs : 0),
    };
    const fn = keys[e.key] ?? keys[e.key.toLowerCase()];
    if (fn) {
      e.preventDefault();
      fn();
    }
  });
  new ResizeObserver(layout).observe(ui.viewport);
  new ResizeObserver(() => setView(view.start, view.span)).observe(ui.track);

  // Errors the reel throws (forwarded by a script the server injects).
  addEventListener("message", (e) => {
    const d = e.data as { kamishibaiDev?: string; message?: string } | null;
    if (d && d.kamishibaiDev === "error") showError(d.message ?? "error");
  });

  const events = new EventSource(`${PREFIX}events`);
  events.onmessage = (e) => {
    const ev = JSON.parse(e.data) as { type: "reload" } | { type: "error"; message: string };
    if (ev.type === "reload") void load();
    else {
      hideError();
      showError(`Build failed — showing the last good build.\n\n${ev.message}`);
    }
  };
}

async function main(): Promise<void> {
  cfg = (await (await fetch(`${PREFIX}config`)).json()) as Config;
  muted = cfg.mute ?? storageGet(MUTE_KEY) === "true";
  const stored = storageGet(CC_KEY) as Cc | null;
  cc = cfg.cc ?? (stored && CC_MODES.includes(stored) ? stored : "captions");
  // The box is right-to-left so a long path is cut at its start; the mark
  // keeps the path itself reading left to right.
  ui.entry.textContent = `\u200e${cfg.entry}`;
  ui.entry.title = cfg.entry;
  document.title = `${cfg.entry} — kamishibai dev`;
  bind();
  update();
  await load();
}

void main();
