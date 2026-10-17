// The Node host for canvas reels: load the entry, register its fonts, give it
// an Env, and paint frames on Skia (@napi-rs/canvas) with no browser.
// ------------------------------------------------------------------
import { mkdtemp, rm, copyFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { build, type Plugin } from "esbuild";
import { frameTimeMs } from "../protocol.ts";
import { chunkIndices, type Chunk } from "../segment.ts";
import { TTS_HOOK } from "../tts/index.ts";
import { isDataEntry, kitDataPlugin } from "../kit-entry.ts";
import { isCanvasReel, splitFontWeight, type CanvasReel, type Context2D, type Env, type View } from "./types.ts";

type Skia = typeof import("@napi-rs/canvas");
let skia: Skia | undefined;

/** @napi-rs/canvas, an optional peer dependency: loaded only for a canvas reel. */
export async function loadSkia(): Promise<Skia> {
  if (skia) return skia;
  try {
    skia = await import("@napi-rs/canvas");
  } catch {
    throw new Error(
      "rendering a canvas reel needs @napi-rs/canvas (Skia for Node): npm i -D @napi-rs/canvas",
    );
  }
  return skia;
}

// ---- loading the entry ------------------------------------------------------

/**
 * Bare imports stay external, as absolute paths, so the bundle can live in a
 * temp dir and still load the reel's own packages (native ones included).
 */
export const externalPackages: Plugin = {
  name: "kamishibai-external-packages",
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, async (args) => {
      if (args.path.startsWith("node:") || args.pluginData?.inner) return undefined;
      const r = await b.resolve(args.path, { kind: args.kind, resolveDir: args.resolveDir, pluginData: { inner: true } });
      if (r.errors.length) return undefined;
      // Node's own modules ("fs" written without "node:") come back unresolved.
      if (!r.path || !isAbsolute(r.path)) return { path: args.path, external: true };
      return { path: pathToFileURL(r.path).href, external: true };
    });
  },
};

export interface CanvasEntry {
  reel: CanvasReel;
  /** the entry, bundled for Node; workers import this */
  bundle: string;
  /** the entry's folder: fonts, images and text files are relative to it */
  dir: string;
  close(): Promise<void>;
}

/**
 * Load a script entry as a canvas reel, or return null for anything else.
 * The entry is bundled first and run only when it has a default export, so a
 * page entry (which calls mount() and touches the DOM) never runs in Node.
 */
export async function loadCanvasEntry(entry: string): Promise<CanvasEntry | null> {
  const abs = resolve(entry);
  const tmp = await mkdtemp(join(tmpdir(), "kamishibai-canvas-"));
  const bundle = join(tmp, "reel.mjs");
  const close = () => rm(tmp, { recursive: true, force: true });
  try {
    const result = await build({
      entryPoints: [abs],
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node20",
      outfile: bundle,
      jsx: "automatic",
      metafile: true,
      logLevel: "silent",
      plugins: [...(isDataEntry(abs) ? [kitDataPlugin(abs)] : []), externalPackages],
    });
    const out = Object.values(result.metafile.outputs)[0];
    if (!out?.exports.includes("default")) {
      await close();
      return null;
    }
    const mod = await import(pathToFileURL(bundle).href);
    if (!isCanvasReel(mod.default)) {
      await close();
      return null;
    }
    return { reel: mod.default, bundle, dir: dirname(abs), close };
  } catch (err) {
    await close();
    // A page entry with a default export may fail to run in Node: it is a page.
    // A kit reel (a .json / .yaml one above all) is never a page: say what's wrong.
    if (err instanceof Error && (/esbuild|Build failed/.test(err.message) || err.name === "KitSpecError" || isDataEntry(abs))) throw err;
    return null;
  }
}

// ---- the host -------------------------------------------------------------

/** Called with every string a context measures or draws, and its font (export collects glyphs with it). */
let textRecorder: ((font: string, text: string) => void) | undefined;
export function recordText(fn: typeof textRecorder): void {
  textRecorder = fn;
}

/** Families registered from a variable font: their weight goes on the wght axis. */
const variable = new Set<string>();

export async function registerFonts(reel: CanvasReel, dir: string): Promise<void> {
  const { GlobalFonts } = await loadSkia();
  for (const f of reel.fonts ?? []) {
    const path = resolve(dir, f.src);
    if (!existsSync(path)) throw new Error(`font not found: ${f.src} (relative to ${dir})`);
    GlobalFonts.registerFromPath(path, f.family);
    if (GlobalFonts.hasVariations(f.family, 400, 5, 0)) variable.add(f.family);
  }
}

/**
 * Where each textBaseline sits relative to the alphabetic one, the way
 * browsers place it: on the em box scaled to the font size (top, middle,
 * bottom), 0.8 of the ascent (hanging), and the font's descent (ideographic).
 * Skia measures them on the font's own ascent and descent instead, which puts
 * a "middle" line of text several pixels off from a browser's.
 */
function baselineShift(baseline: string, ascent: number, descent: number, size: number): number {
  const emA = (size * ascent) / (ascent + descent || 1);
  const emD = size - emA;
  switch (baseline) {
    case "top":
      return emA;
    case "middle":
      return (emA - emD) / 2;
    case "bottom":
      return -emD;
    case "hanging":
      return 0.8 * ascent;
    case "ideographic":
      return -descent;
    default:
      return 0;
  }
}

/**
 * Make a Skia context draw text as a browser does:
 *
 * - Any weight in `font`. Skia parses only multiples of 100 there, and draws a
 *   variable font wrongly from `font` alone, so the nearest hundred goes in
 *   `font` (it picks a static fallback face) and the exact weight on the wght
 *   axis when the first family is a variable font.
 * - textBaseline as browsers define it (see baselineShift): text is drawn on
 *   the alphabetic baseline, moved by the difference, and measureText reports
 *   its vertical metrics from the baseline asked for.
 */
export function patchContext(g: Context2D): Context2D {
  const proto = Object.getPrototypeOf(g);
  const font = Object.getOwnPropertyDescriptor(proto, "font")!;
  const baseline = Object.getOwnPropertyDescriptor(proto, "textBaseline")!;
  const ctx = g as Context2D & { fontVariationSettings: string };
  let fontAsSet = font.get!.call(g) as string;
  let baselineAsSet = baseline.get!.call(g) as CanvasTextBaseline;
  baseline.set!.call(g, "alphabetic");
  Object.defineProperty(g, "font", {
    configurable: true,
    get: () => fontAsSet,
    set(v: string) {
      const parsed = splitFontWeight(String(v));
      font.set!.call(g, parsed ? parsed.rounded : v);
      fontAsSet = String(v);
      ctx.fontVariationSettings = parsed && variable.has(parsed.families[0]!) ? `"wght" ${parsed.weight}` : "normal";
    },
  });
  Object.defineProperty(g, "textBaseline", {
    configurable: true,
    get: () => baselineAsSet,
    set: (v: CanvasTextBaseline) => void (baselineAsSet = v),
  });
  // save/restore/reset cover the real context's state; the font and baseline
  // kept here go on the same stack.
  const stack: [string, CanvasTextBaseline][] = [];
  const save = proto.save as () => void;
  const restore = proto.restore as () => void;
  const reset = proto.reset as (() => void) | undefined;
  Object.defineProperty(g, "save", { configurable: true, value: () => (stack.push([fontAsSet, baselineAsSet]), save.call(g)) });
  Object.defineProperty(g, "restore", {
    configurable: true,
    value: () => {
      restore.call(g);
      const top = stack.pop();
      if (top) ((g as { font: string }).font = top[0]), (baselineAsSet = top[1]);
    },
  });
  if (reset)
    Object.defineProperty(g, "reset", {
      configurable: true,
      value: () => {
        reset.call(g);
        stack.length = 0;
        (g as { font: string }).font = "10px sans-serif";
        baselineAsSet = "alphabetic";
        baseline.set!.call(g, "alphabetic");
      },
    });
  const measure = proto.measureText as (t: string) => TextMetrics;
  const shift = (): number => {
    if (baselineAsSet === "alphabetic") return 0;
    // The font box is the first font's, whatever the text; Skia reports 0 for "".
    const m = measure.call(g, "x");
    const size = Number(/([\d.]+)px/.exec(font.get!.call(g) as string)?.[1] ?? 10);
    return baselineShift(baselineAsSet, m.fontBoundingBoxAscent, m.fontBoundingBoxDescent, size);
  };
  for (const name of ["fillText", "strokeText"] as const) {
    const draw = proto[name] as (t: string, x: number, y: number, w?: number) => void;
    Object.defineProperty(g, name, {
      configurable: true,
      value: (t: string, x: number, y: number, w?: number) => {
        textRecorder?.(fontAsSet, String(t));
        return w === undefined ? draw.call(g, t, x, y + shift()) : draw.call(g, t, x, y + shift(), w);
      },
    });
  }
  Object.defineProperty(g, "measureText", {
    configurable: true,
    value: (t: string) => {
      textRecorder?.(fontAsSet, String(t));
      const m = measure.call(g, t);
      const k = shift();
      if (!k) return m;
      // Vertical metrics are measured from the baseline asked for.
      return {
        width: m.width,
        actualBoundingBoxLeft: m.actualBoundingBoxLeft,
        actualBoundingBoxRight: m.actualBoundingBoxRight,
        actualBoundingBoxAscent: m.actualBoundingBoxAscent - k,
        actualBoundingBoxDescent: m.actualBoundingBoxDescent + k,
        fontBoundingBoxAscent: m.fontBoundingBoxAscent - k,
        fontBoundingBoxDescent: m.fontBoundingBoxDescent + k,
        emHeightAscent: m.emHeightAscent - k,
        emHeightDescent: m.emHeightDescent + k,
        alphabeticBaseline: -k,
        hangingBaseline: (m.hangingBaseline ?? 0.8 * m.fontBoundingBoxAscent) - k,
        ideographicBaseline: (m.ideographicBaseline ?? -m.fontBoundingBoxDescent) - k,
      } as TextMetrics;
    },
  });
  return g;
}

/** What an Env read, by the path the reel asked for (export embeds these). */
export interface EnvReads {
  texts: Map<string, string>;
  images: Map<string, string>;
}

export async function nodeEnv(dir: string, reads?: EnvReads): Promise<Env> {
  const { createCanvas, loadImage } = await loadSkia();
  return {
    createCanvas(w, h) {
      const c = createCanvas(Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h)));
      const getContext = c.getContext.bind(c);
      let g: Context2D | undefined;
      return Object.assign(c, { getContext: () => (g ??= patchContext(getContext("2d") as unknown as Context2D)) }) as never;
    },
    loadImage: (path) => {
      const file = resolve(dir, path);
      reads?.images.set(path, file);
      return loadImage(file) as never;
    },
    readText: (path) => {
      const text = readFileSync(resolve(dir, path), "utf8");
      reads?.texts.set(path, text);
      return text;
    },
  };
}

// ---- painting a chunk -------------------------------------------------------

const frameName = (i: number): string => `f${String(i).padStart(6, "0")}.png`;

export interface PaintChunkOptions {
  reel: CanvasReel;
  dir: string;
  view: View;
  fps: number;
  chunk: Chunk;
  framesDir: string;
  prevFingerprints?: Map<number, string>;
  shouldRender?: (i: number) => boolean;
  onFrame?: (i: number) => void;
  onFingerprint?: (i: number, fp: string) => void;
}

/**
 * Paint every frame in `chunk` into `framesDir` as f000000.png …, with the
 * same reuse as a page capture: `false` or a repeated fingerprint copies the
 * previous still, a fingerprint equal to last run's keeps the file on disk,
 * and a frame --only leaves out isn't touched.
 */
export async function paintChunk(opts: PaintChunkOptions): Promise<void> {
  const { reel, view, chunk, framesDir, prevFingerprints, shouldRender, onFrame, onFingerprint } = opts;
  const { createCanvas } = await loadSkia();
  await registerFonts(reel, opts.dir);
  const env = await nodeEnv(opts.dir);
  const paint = await reel.setup(view, env);
  const canvas = createCanvas(Math.round(view.width * view.pixelRatio), Math.round(view.height * view.pixelRatio));
  const g = patchContext(canvas.getContext("2d") as unknown as Context2D);

  let prevPath: string | undefined;
  let prevFp: string | undefined;
  for (const i of chunkIndices(chunk)) {
    const thisPath = join(framesDir, frameName(i));
    if (shouldRender && !shouldRender(i)) {
      prevPath = undefined;
      prevFp = undefined;
      onFrame?.(i);
      continue;
    }
    // A fresh state for every frame: what the last one left must not leak in.
    g.reset?.();
    g.setTransform(view.pixelRatio, 0, 0, view.pixelRatio, 0, 0);
    g.clearRect(0, 0, view.width, view.height);
    const changed = paint(g, frameTimeMs(i, opts.fps));
    const fp = typeof changed === "string" ? changed : undefined;
    if (fp !== undefined) onFingerprint?.(i, fp);
    const cacheHit = fp !== undefined && prevFingerprints?.get(i) === fp && existsSync(thisPath);
    const sameAsPrev = !cacheHit && !!prevPath && (changed === false || (fp !== undefined && fp === prevFp));
    if (cacheHit) {
      // already on disk
    } else if (sameAsPrev) {
      await copyFile(prevPath!, thisPath);
    } else {
      await writeFile(thisPath, await canvas.encode("png"));
    }
    prevPath = thisPath;
    prevFp = fp;
    onFrame?.(i);
  }
}

/** Route this thread's prepareNarration calls to `handle` (a TTS engine, or a worker's line to the main thread). */
export function setTTSHook(handle: ((body: unknown) => Promise<unknown>) | undefined): void {
  (globalThis as Record<string, unknown>)[TTS_HOOK] = handle;
}
