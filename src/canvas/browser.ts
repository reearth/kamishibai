// kamishibai/canvas — canvas reels, and the browser host for them.
// ------------------------------------------------------------------
// A canvas reel is a module whose default export draws a frame on a 2D
// canvas for a time `ms` (see ./types.ts). `kamishibai render` paints it on the
// CPU with no browser. In a browser, mountCanvas() draws it into a canvas and
// exposes the page contract, window.kamishibai = { meta, seek }, so every tool
// for pages (Chrome capture, `kamishibai dev`) works with it too.
//
// Safe to import in Node: nothing here touches the DOM until it is called.
// ------------------------------------------------------------------
import { GLOBAL_KEY, type KamishibaiPage } from "../protocol.ts";
import { NO_INSETS, aspectRange, resolveView, type CanvasReel, type Context2D, type Env, type Insets, type Painter, type View } from "./types.ts";

export * from "./types.ts";

/**
 * Load the reel's fonts with the FontFace API. `src` is resolved against
 * `base`, unless `urls` has it (an exported file carries its fonts as data).
 */
export async function loadFonts(reel: CanvasReel, base: string, urls?: Record<string, string>): Promise<void> {
  const faces = (reel.fonts ?? []).map((f) => {
    const url = urls?.[f.src] ?? new URL(f.src, base).href;
    const face = new FontFace(f.family, `url(${JSON.stringify(url)})`, {
      weight: String(f.weight ?? 400),
      style: f.style ?? "normal",
    });
    document.fonts.add(face);
    return face.load();
  });
  await Promise.all(faces);
}

/** The browser's Env: files are fetched relative to `base`, unless `texts` or `images` has them. */
export function browserEnv(base: string, embedded: { texts?: Record<string, string>; images?: Record<string, string> } = {}): Env {
  return {
    createCanvas(w, h) {
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.ceil(w));
      c.height = Math.max(1, Math.ceil(h));
      return c as never;
    },
    async loadImage(path) {
      const img = new Image();
      img.src = embedded.images?.[path] ?? new URL(path, base).href;
      await img.decode();
      return img;
    },
    readText(path) {
      const text = embedded.texts?.[path];
      if (text !== undefined) return text;
      // Synchronous, as Env.readText is: setup reads quoted files while it lays out.
      const x = new XMLHttpRequest();
      x.open("GET", new URL(path, base).href, false);
      x.send();
      if (x.status !== 200) throw new Error(`can't read ${path}: HTTP ${x.status}`);
      return x.responseText;
    },
  };
}

export interface MountOptions {
  /** where the reel's fonts and files are fetched from (default: the page's URL) */
  base?: string;
  /** the element to draw in (default: #kamishibai-root, else the body) */
  parent?: HTMLElement;
}

/**
 * Draw a canvas reel into a canvas of its meta size and expose it as a page:
 * window.kamishibai = { meta, seek, audio, subtitles }. Resolves once its
 * fonts are loaded and setup has run.
 */
export async function mountCanvas(reel: CanvasReel, opts: MountOptions = {}): Promise<KamishibaiPage> {
  const base = opts.base ?? document.baseURI;
  const { width, height, fps, durationMs } = reel.meta;
  const dpr = window.devicePixelRatio || 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.cssText = `display:block;width:${width}px;height:${height}px`;
  (opts.parent ?? document.getElementById("kamishibai-root") ?? document.body).appendChild(canvas);
  const g = canvas.getContext("2d")! as Context2D;

  await loadFonts(reel, base);
  // The renderer tells the page its sampling rate before anything runs; a
  // page it doesn't drive is being watched in kamishibai's player.
  const rendering = (window as { __KAMISHIBAI_FPS__?: number }).__KAMISHIBAI_FPS__ !== undefined;
  const view: View = { width, height, pixelRatio: dpr, medium: rendering ? "video" : "player", insets: { ...NO_INSETS } };
  const paint = await reel.setup(view, browserEnv(base));

  const page: KamishibaiPage = {
    meta: { fps, durationMs, width, height },
    audio: reel.audio ? [...reel.audio] : undefined,
    subtitles: reel.subtitles ? [...reel.subtitles] : undefined,
    seek(ms) {
      g.reset?.();
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, width, height);
      return paint(g, ms);
    },
  };
  (window as unknown as Record<string, unknown>)[GLOBAL_KEY] = page;
  page.seek(0);
  return page;
}

// ---- the player -------------------------------------------------------------

/**
 * Player options from a page's query string, over `defaults`: controls=0|1,
 * autoplay=0|1, loop=n (as --gif-loop: 0 = forever, -1 = once, n = n more
 * times), t=<seconds> to start at, muted=0|1. A value that doesn't parse is
 * left out, with a warning.
 */
export function optionsFromQuery(search: string, defaults: PlayOptions = {}): PlayOptions {
  const q = new URLSearchParams(search);
  const out: PlayOptions = { ...defaults };
  const warn = (k: string) => console.warn(`kamishibai: ignoring ?${k}=${q.get(k)}`);
  const flag = (k: "controls" | "autoplay" | "muted") => {
    const v = q.get(k);
    if (v === null) return;
    if (v === "1" || v === "true" || v === "") out[k] = true;
    else if (v === "0" || v === "false") out[k] = false;
    else warn(k);
  };
  flag("controls");
  flag("autoplay");
  flag("muted");
  const loop = q.get("loop");
  if (loop !== null) {
    const n = Number(loop);
    if (Number.isInteger(n) && n >= -1 && loop.trim() !== "") out.loop = n === 0 ? true : n === -1 ? false : n;
    else warn("loop");
  }
  const t = q.get("t");
  if (t !== null) {
    const s = Number(t.replace(/s$/, ""));
    if (s >= 0 && Number.isFinite(s)) out.startMs = s * 1000;
    else warn("t");
  }
  return out;
}

export interface PlayOptions {
  /** show play/pause, a seek bar and the time (default true) */
  controls?: boolean;
  /** start playing at once (default: true, unless the viewer prefers reduced motion) */
  autoplay?: boolean;
  /** play again from the start: true = forever, a number = that many more times (default false: once) */
  loop?: boolean | number;
  /** where to start, in ms (default 0) */
  startMs?: number;
  /** start with the soundtrack muted */
  muted?: boolean;
  /** space the reel keeps clear of, in layout units */
  insets?: Partial<Insets>;
  /** "player" (default) or "embed", passed to the reel as view.medium */
  medium?: "player" | "embed";
  /** where the reel's fonts and files are fetched from (default: the page's URL) */
  base?: string;
  /** embedded data, by the path the reel asks for (kamishibai export fills these) */
  texts?: Record<string, string>;
  images?: Record<string, string>;
  fonts?: Record<string, string>;
  /** one audio file for the whole reel; the player follows its clock while it plays */
  soundtrack?: string;
}

export interface Player {
  play(): void;
  pause(): void;
  seek(ms: number): void;
  readonly ms: number;
  readonly playing: boolean;
  readonly durationMs: number;
  /** the view the reel is laid out for now */
  readonly view: View;
  destroy(): void;
}

const PLAYER_CSS = `
.ksp{position:relative;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;outline:none}
.ksp canvas{display:block;cursor:pointer}
.ksp-bar{display:flex;align-items:center;gap:10px;font:12px/1 ui-monospace,monospace;color:#6e6e69}
.ksp-bar button{all:unset;cursor:pointer;width:32px;height:28px;text-align:center;background:#121212;color:#fff;border-radius:4px;font:14px/28px system-ui,sans-serif}
.ksp-bar input{flex:1;accent-color:#d9662a}`;
const BAR_H = 36;

/**
 * Play a canvas reel in `el`, laid out for the element's shape (within
 * meta.aspect) and laid out again when it changes. Returns a handle a page can
 * drive, from scroll for example.
 */
export async function play(reel: CanvasReel, el: HTMLElement, opts: PlayOptions = {}): Promise<Player> {
  const base = opts.base ?? document.baseURI;
  const { durationMs } = reel.meta;
  const controls = opts.controls ?? true;
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  await loadFonts(reel, base, opts.fonts);
  const env = browserEnv(base, { texts: opts.texts, images: opts.images });

  if (!document.getElementById("ksp-css")) {
    const style = document.createElement("style");
    style.id = "ksp-css";
    style.textContent = PLAYER_CSS;
    document.head.appendChild(style);
  }
  const root = document.createElement("div");
  root.className = "ksp";
  root.tabIndex = 0;
  const canvas = document.createElement("canvas");
  root.appendChild(canvas);
  let bar: { el: HTMLElement; btn: HTMLButtonElement; seek: HTMLInputElement; time: HTMLElement; mute?: HTMLButtonElement } | undefined;
  if (controls) {
    const b = document.createElement("div");
    b.className = "ksp-bar";
    b.innerHTML = `<button type="button" aria-label="Play">▶</button><input type="range" min="0" step="1" aria-label="Seek"><span></span>`;
    bar = { el: b, btn: b.querySelector("button")!, seek: b.querySelector("input")!, time: b.querySelector("span")! };
    bar.seek.max = String(durationMs);
    if (opts.soundtrack) {
      const m = document.createElement("button");
      m.type = "button";
      b.appendChild(m);
      bar.mute = m;
    }
    root.appendChild(b);
  }
  el.appendChild(root);
  const g = canvas.getContext("2d")! as Context2D;

  const audio = opts.soundtrack ? new Audio(opts.soundtrack) : undefined;
  if (audio) {
    audio.preload = "auto";
    audio.muted = !!opts.muted;
  }

  // Painters by view: a shape the element took before is drawn at once.
  const painters = new Map<string, Promise<Painter>>();
  let view: View = resolveView(reel.meta, { medium: opts.medium ?? "player", insets: opts.insets });
  let paint: Painter | undefined;
  const range = aspectRange(reel.meta);
  async function fit() {
    const w = el.clientWidth || reel.meta.width;
    const h = (el.clientHeight || (w * reel.meta.height) / reel.meta.width) - (controls ? BAR_H + 8 : 0);
    // Rounded, then clamped, so a small resize reuses a layout and the ends of meta.aspect stay exact.
    const r = Math.min(range.max, Math.max(range.min, Math.round((w / Math.max(1, h)) * 20) / 20));
    const next = resolveView(reel.meta, { aspect: r, medium: opts.medium ?? "player", insets: opts.insets });
    const cssW = Math.min(w, h * (next.width / next.height));
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${(cssW * next.height) / next.width}px`;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round((cssW * dpr * next.height) / next.width);
    if (bar) bar.el.style.width = `${cssW}px`;
    next.pixelRatio = canvas.width / next.width;
    const key = `${next.width}x${next.height}`;
    if (!painters.has(key)) painters.set(key, Promise.resolve(reel.setup(next, env)));
    const p = await painters.get(key)!;
    view = next;
    paint = p;
    draw();
  }

  let ms = 0;
  let playing = false;
  let repeats = 0;
  const again = () => (opts.loop === true ? true : typeof opts.loop === "number" && repeats < opts.loop ? (repeats++, true) : false);
  let clockAt = 0;
  let clockMs = 0;
  function draw() {
    if (!paint) return;
    g.reset?.();
    g.setTransform(view.pixelRatio, 0, 0, view.pixelRatio, 0, 0);
    g.clearRect(0, 0, view.width, view.height);
    paint(g, Math.min(ms, durationMs - 1));
    if (bar) {
      const fmt = (v: number) => `${Math.floor(v / 60000)}:${String(Math.floor(v / 1000) % 60).padStart(2, "0")}`;
      bar.seek.value = String(ms);
      bar.time.textContent = `${fmt(ms)} / ${fmt(durationMs)}`;
      bar.btn.textContent = playing ? "❚❚" : "▶";
      bar.btn.ariaLabel = playing ? "Pause" : "Play";
      if (bar.mute && audio) bar.mute.textContent = audio.muted ? "🔇" : "🔊";
    }
  }
  let frame = 0;
  function tick(now: number) {
    if (!playing) return;
    // The soundtrack is the clock while it plays; otherwise the wall clock.
    ms = audio && !audio.paused ? audio.currentTime * 1000 : clockMs + (now - clockAt);
    if (ms >= durationMs) {
      if (again()) return void seekTo(0, true);
      ms = durationMs;
      return void pause();
    }
    draw();
    frame = requestAnimationFrame(tick);
  }
  function seekTo(t: number, keepPlaying = playing) {
    ms = Math.max(0, Math.min(durationMs, t));
    clockMs = ms;
    clockAt = performance.now();
    if (audio) audio.currentTime = ms / 1000;
    if (keepPlaying) start();
    else draw();
  }
  function start() {
    // Played to the end: a new play counts its repeats afresh.
    if (ms >= durationMs) (repeats = 0), seekTo(0, false);
    playing = true;
    clockMs = ms;
    clockAt = performance.now();
    // Browsers refuse sound until the viewer has interacted: then play muted.
    audio?.play().catch(() => {
      if (!audio) return;
      audio.muted = true;
      audio.play().catch(() => {});
    });
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(tick);
  }
  function pause() {
    playing = false;
    audio?.pause();
    cancelAnimationFrame(frame);
    draw();
  }

  canvas.addEventListener("click", () => (playing ? pause() : start()));
  bar?.btn.addEventListener("click", () => (playing ? pause() : start()));
  // Scrubbing pauses, as in a video player.
  bar?.seek.addEventListener("input", () => (pause(), seekTo(Number(bar!.seek.value), false)));
  bar?.mute?.addEventListener("click", () => audio && ((audio.muted = !audio.muted), draw()));
  root.addEventListener("keydown", (e) => {
    if (e.key === " ") (playing ? pause() : start()), e.preventDefault();
    else if (e.key === "ArrowRight") seekTo(ms + 1000 / reel.meta.fps, false);
    else if (e.key === "ArrowLeft") seekTo(ms - 1000 / reel.meta.fps, false);
  });
  let resizing: ReturnType<typeof setTimeout> | undefined;
  const ro = new ResizeObserver(() => {
    clearTimeout(resizing);
    resizing = setTimeout(fit, 100);
  });
  ro.observe(el);

  await fit();
  if (opts.startMs) seekTo(opts.startMs, false);
  if (opts.autoplay ?? !reduced) start();

  return {
    play: start,
    pause,
    seek: (t) => seekTo(t, false),
    get ms() {
      return ms;
    },
    get playing() {
      return playing;
    },
    durationMs,
    get view() {
      return view;
    },
    destroy() {
      pause();
      ro.disconnect();
      root.remove();
    },
  };
}
