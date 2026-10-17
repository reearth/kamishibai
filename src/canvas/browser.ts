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
import { createPlayer, type Player, type PlayerOptions } from "../player.ts";

export * from "./types.ts";

/**
 * Load the reel's fonts with the FontFace API. `src` is resolved against
 * `base`, unless `urls` has it (an exported file carries its fonts as data,
 * and leaves out a font nothing is drawn in: that one isn't loaded).
 */
export async function loadFonts(reel: CanvasReel, base: string, urls?: Record<string, string>): Promise<void> {
  const fonts = (reel.fonts ?? []).filter((f) => !urls || urls[f.src]);
  const faces = fonts.map((f) => {
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

export { optionsFromQuery } from "../player.ts";

export interface PlayOptions extends PlayerOptions {
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
}

export interface CanvasPlayer extends Player {
  /** the view the reel is laid out for now */
  readonly view: View;
}

/**
 * Play a canvas reel in `el`, laid out for the element's shape (within
 * meta.aspect) and laid out again when it changes. Returns a handle a page can
 * drive, from scroll for example.
 */
export async function play(reel: CanvasReel, el: HTMLElement, opts: PlayOptions = {}): Promise<CanvasPlayer> {
  const base = opts.base ?? document.baseURI;
  await loadFonts(reel, base, opts.fonts);
  const env = browserEnv(base, { texts: opts.texts, images: opts.images });
  const canvas = document.createElement("canvas");
  const g = canvas.getContext("2d")! as Context2D;
  const medium = opts.medium ?? "player";

  // Painters by view: a shape the element took before is drawn at once.
  const painters = new Map<string, Promise<Painter>>();
  let view: View = resolveView(reel.meta, { medium, insets: opts.insets });
  let paint: Painter | undefined;
  const range = aspectRange(reel.meta);

  const player = await createPlayer(
    el,
    {
      element: canvas,
      durationMs: reel.meta.durationMs,
      fps: reel.meta.fps,
      async fit(w, h) {
        // Rounded, then clamped, so a small resize reuses a layout and the ends of meta.aspect stay exact.
        const r = Math.min(range.max, Math.max(range.min, Math.round((w / h) * 20) / 20));
        const next = resolveView(reel.meta, { aspect: r, medium, insets: opts.insets });
        const cssW = Math.min(w, h * (next.width / next.height));
        const cssH = (cssW * next.height) / next.width;
        const dpr = window.devicePixelRatio || 1;
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
        next.pixelRatio = canvas.width / next.width;
        const key = `${next.width}x${next.height}`;
        if (!painters.has(key)) painters.set(key, Promise.resolve(reel.setup(next, env)));
        paint = await painters.get(key)!;
        view = next;
        return { width: cssW, height: cssH };
      },
      draw(ms) {
        if (!paint) return;
        g.reset?.();
        g.setTransform(view.pixelRatio, 0, 0, view.pixelRatio, 0, 0);
        g.clearRect(0, 0, view.width, view.height);
        paint(g, ms);
      },
    },
    opts,
  );
  return Object.defineProperty(player, "view", { get: () => view }) as CanvasPlayer;
}
