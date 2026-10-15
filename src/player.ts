// The player behind `kamishibai export`: controls, a clock, a soundtrack,
// loops and captions, around a surface that draws the reel at a time. A canvas
// reel's surface lays it out for the element's shape (canvas/browser.ts); a
// page's scales the page to fit and calls its seek(ms) (playPage, below).
//
// Browser only, and safe to import in Node: nothing runs until it is called.
// ------------------------------------------------------------------
import { GLOBAL_KEY, type KamishibaiPage } from "./protocol.ts";
import { cueAt, type Cue } from "./subtitle.ts";

/** What the player draws on. */
export interface Surface {
  /** the element that shows the reel; a click on it plays or pauses */
  element: HTMLElement;
  durationMs: number;
  fps: number;
  /** size to at most w × h CSS pixels; returns the size taken */
  fit(w: number, h: number): Promise<{ width: number; height: number }>;
  /** show the reel at `ms` */
  draw(ms: number): void;
}

export interface PlayerOptions {
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
  /** one audio file for the whole reel; the player follows its clock while it plays */
  soundtrack?: string;
  /** subtitle cues to show as captions over the picture */
  subtitles?: Cue[];
  /** show the subtitles (default true when there are any) */
  captions?: boolean;
}

export interface Player {
  play(): void;
  pause(): void;
  seek(ms: number): void;
  readonly ms: number;
  readonly playing: boolean;
  readonly durationMs: number;
  destroy(): void;
}

/**
 * Player options from a page's query string, over `defaults`: controls=0|1,
 * autoplay=0|1, loop=n (as --gif-loop: 0 = forever, -1 = once, n = n more
 * times), t=<seconds> to start at, muted=0|1, cc=0|1 for captions. A value
 * that doesn't parse is left out, with a warning.
 */
export function optionsFromQuery<T extends PlayerOptions>(search: string, defaults: T = {} as T): T {
  const q = new URLSearchParams(search);
  const out: T = { ...defaults };
  const warn = (k: string) => console.warn(`kamishibai: ignoring ?${k}=${q.get(k)}`);
  const flag = (k: string, key: "controls" | "autoplay" | "muted" | "captions") => {
    const v = q.get(k);
    if (v === null) return;
    if (v === "1" || v === "true" || v === "") out[key] = true;
    else if (v === "0" || v === "false") out[key] = false;
    else warn(k);
  };
  flag("controls", "controls");
  flag("autoplay", "autoplay");
  flag("muted", "muted");
  flag("cc", "captions");
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

const PLAYER_CSS = `
.ksp{position:relative;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;outline:none}
.ksp-pic{position:relative;cursor:pointer}
.ksp-pic>canvas{display:block}
.ksp-cc{position:absolute;left:5%;right:5%;bottom:6%;text-align:center;pointer-events:none}
.ksp-cc span{background:rgba(0,0,0,.72);color:#fff;padding:.15em .45em;border-radius:.2em;line-height:1.5;box-decoration-break:clone;-webkit-box-decoration-break:clone;white-space:pre-wrap;font-family:system-ui,sans-serif}
.ksp-bar{display:flex;align-items:center;gap:10px;font:12px/1 ui-monospace,monospace;color:#6e6e69}
.ksp-bar button{all:unset;cursor:pointer;min-width:32px;height:28px;text-align:center;background:#121212;color:#fff;border-radius:4px;font:14px/28px system-ui,sans-serif}
.ksp-bar input{flex:1;accent-color:#d9662a}`;
const BAR_H = 36;

/** Play what `surface` draws in `el`, sized to the element and again when it changes. */
export async function createPlayer(el: HTMLElement, surface: Surface, opts: PlayerOptions = {}): Promise<Player> {
  const { durationMs } = surface;
  const controls = opts.controls ?? true;
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (!document.getElementById("ksp-css")) {
    const style = document.createElement("style");
    style.id = "ksp-css";
    style.textContent = PLAYER_CSS;
    document.head.appendChild(style);
  }
  const root = document.createElement("div");
  root.className = "ksp";
  root.tabIndex = 0;
  const pic = document.createElement("div");
  pic.className = "ksp-pic";
  pic.appendChild(surface.element);
  root.appendChild(pic);
  const cues = opts.subtitles ?? [];
  let cc: HTMLElement | undefined;
  if (cues.length && (opts.captions ?? true)) {
    cc = document.createElement("div");
    cc.className = "ksp-cc";
    pic.appendChild(cc);
  }
  let bar: { el: HTMLElement; btn: HTMLButtonElement; seek: HTMLInputElement; time: HTMLElement; mute?: HTMLButtonElement } | undefined;
  const audio = opts.soundtrack ? new Audio(opts.soundtrack) : undefined;
  if (audio) {
    audio.preload = "auto";
    audio.muted = !!opts.muted;
  }
  if (controls) {
    const b = document.createElement("div");
    b.className = "ksp-bar";
    b.innerHTML = `<button type="button" aria-label="Play">▶</button><input type="range" min="0" step="1" aria-label="Seek"><span></span>`;
    bar = { el: b, btn: b.querySelector("button")!, seek: b.querySelector("input")!, time: b.querySelector("span")! };
    bar.seek.max = String(durationMs);
    if (audio) {
      const m = document.createElement("button");
      m.type = "button";
      b.appendChild(m);
      bar.mute = m;
    }
    root.appendChild(b);
  }
  el.appendChild(root);

  async function fit() {
    const w = el.clientWidth || 640;
    const h = (el.clientHeight || w) - (controls ? BAR_H + 8 : 0);
    const size = await surface.fit(w, Math.max(1, h));
    if (bar) bar.el.style.width = `${size.width}px`;
    if (cc) cc.style.fontSize = `${Math.max(12, size.height * 0.045)}px`;
    draw();
  }

  let ms = 0;
  let playing = false;
  let repeats = 0;
  const again = () => (opts.loop === true ? true : typeof opts.loop === "number" && repeats < opts.loop ? (repeats++, true) : false);
  let clockAt = 0;
  let clockMs = 0;
  let shownCue: Cue | undefined | null = null;
  function draw() {
    surface.draw(Math.min(ms, durationMs - 1));
    if (cc) {
      const cue = cueAt(cues, ms);
      if (cue !== shownCue) {
        shownCue = cue;
        cc.innerHTML = "";
        if (cue) cc.appendChild(document.createElement("span")).textContent = cue.text;
      }
    }
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

  pic.addEventListener("click", () => (playing ? pause() : start()));
  bar?.btn.addEventListener("click", () => (playing ? pause() : start()));
  // Scrubbing pauses, as in a video player.
  bar?.seek.addEventListener("input", () => (pause(), seekTo(Number(bar!.seek.value), false)));
  bar?.mute?.addEventListener("click", () => audio && ((audio.muted = !audio.muted), draw()));
  root.addEventListener("keydown", (e) => {
    if (e.key === " ") (playing ? pause() : start()), e.preventDefault();
    else if (e.key === "ArrowRight") seekTo(ms + 1000 / surface.fps, false);
    else if (e.key === "ArrowLeft") seekTo(ms - 1000 / surface.fps, false);
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
    destroy() {
      pause();
      ro.disconnect();
      root.remove();
    },
  };
}

// ---- a page ----------------------------------------------------------------

/**
 * The page's reel, once it has exposed window.kamishibai (mount() may do so
 * after an await, such as prepareNarration).
 */
export function waitForPage(timeoutMs = 30_000): Promise<KamishibaiPage> {
  const started = performance.now();
  return new Promise((ok, ng) => {
    const look = () => {
      const k = (window as unknown as Record<string, KamishibaiPage | undefined>)[GLOBAL_KEY];
      if (k?.meta && typeof k.seek === "function") return ok(k);
      if (performance.now() - started > timeoutMs) return ng(new Error("the page never exposed window.kamishibai"));
      requestAnimationFrame(look);
    };
    look();
  });
}

/**
 * Play the page's own reel (window.kamishibai) in `el`: the page, drawn in
 * `root` at its meta size, is scaled to fit, and played by calling seek(ms).
 * A seek still settling when the next frame comes is let finish; the newest
 * time is drawn next.
 *
 * kamishibai/react mounts into #kamishibai-root, but a raw page may add its
 * elements to the body: whatever the page puts in the body, now or later,
 * moves into `root`, where it is at the top left as in a capture.
 */
export async function playPage(el: HTMLElement, root: HTMLElement, opts: PlayerOptions = {}): Promise<Player> {
  const page = await waitForPage();
  await document.fonts.ready;
  const { width: W, height: H, fps, durationMs } = page.meta;
  const stage = document.createElement("div");
  stage.style.cssText = "position:relative;overflow:hidden";
  root.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;transform-origin:0 0`;
  stage.appendChild(root);
  const own = (n: Node) => n === el || n === root || n === stage || n.contains(el) || (n instanceof HTMLScriptElement) || (n instanceof Element && n.id === "kamishibai-data");
  const adopt = (n: Node) => {
    if (!own(n) && !(n instanceof Text && !n.textContent?.trim())) root.appendChild(n);
  };
  [...document.body.childNodes].forEach(adopt);
  new MutationObserver((records) => {
    for (const r of records) r.addedNodes.forEach((n) => n.parentNode === document.body && adopt(n));
  }).observe(document.body, { childList: true });
  let busy = false;
  let pending: number | undefined;
  const seek = (ms: number) => {
    if (busy) return void (pending = ms);
    busy = true;
    Promise.resolve(page.seek(ms)).finally(() => {
      busy = false;
      if (pending !== undefined) {
        const next = pending;
        pending = undefined;
        seek(next);
      }
    });
  };
  return createPlayer(
    el,
    {
      element: stage,
      durationMs,
      fps,
      async fit(w, h) {
        const k = Math.min(w / W, h / H);
        stage.style.width = `${W * k}px`;
        stage.style.height = `${H * k}px`;
        root.style.transform = `scale(${k})`;
        return { width: W * k, height: H * k };
      },
      draw: seek,
    },
    { subtitles: page.subtitles, ...opts },
  );
}
