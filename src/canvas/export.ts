// `kamishibai export`: a reel and its player as one HTML file, which plays
// from anywhere, offline included. This file exports a canvas reel, laid out
// at the shape of the window; a page goes to ../export-page.ts.
// ------------------------------------------------------------------
// Everything the reel reads at run time goes in the file: what its module asks
// for is recorded while every frame is painted once on the CPU, for the default
// view and both ends of meta.aspect. That is the characters each font draws
// (each font is cut to those, as WOFF2), the files setup reads, the narration
// prepareNarration returns, and the soundtrack, mixed into one track.
// ------------------------------------------------------------------
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { exportSound, writeExportHtml } from "../export-html.ts";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import { build, type Plugin } from "esbuild";
import { frameCount, frameTimeMs } from "../protocol.ts";
import { SCRIPT_EXT, bundleOptions, canvasModule } from "../serve.ts";
import { createTTSEngine, type TTSAdapter } from "../tts/engine.ts";
import { loadCanvasEntry, loadSkia, nodeEnv, patchContext, recordText, registerFonts, setTTSHook, type EnvReads } from "./node.ts";
import { resolveView, splitFontWeight, viewKey, type Context2D, type View } from "./types.ts";

export interface ExportOptions {
  /** the canvas reel's module */
  entry: string;
  /** the HTML file to write */
  out: string;
  /** no controls: a canvas that autoplays, for a page to embed */
  bare?: boolean;
  /** as --gif-loop: 0 = forever, -1 = once (default), n = n more times */
  loop?: number;
  /** false: wait for the viewer, or the page, to start it (default: autoplay) */
  autoplay?: boolean;
  /** a page's static assets dir, as for render (a canvas reel reads files next to it) */
  publicDir?: string;
  /** how long to wait for a page to expose window.kamishibai (ms) */
  probeTimeoutMs?: number;
  /** the sound: "mix" (default) mixes it into one track with ffmpeg; "live" carries
   *  each clip's file and plays them with Web Audio, as kamishibai dev does */
  audio?: "mix" | "live";
  /** the soundtrack's AAC bitrate (default "96k") */
  audioBitrate?: string;
  ttsAdapters?: TTSAdapter[];
  ttsCacheDir?: string;
  onLog?: (msg: string) => void;
}

export interface ExportResult {
  out: string;
  bytes: number;
  /** bytes of each part as embedded */
  parts: { script: number; fonts: number; files: number; soundtrack: number };
  /** frames painted to learn what the reel draws */
  frames: number;
}

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
};
const dataUrl = (mime: string, bytes: Uint8Array) => `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;

export async function exportHtml(opts: ExportOptions): Promise<ExportResult> {
  const log = opts.onLog ?? (() => {});
  // Only a script entry can be a canvas reel; the page path says what it takes.
  if (/^https?:\/\//i.test(opts.entry) || !SCRIPT_EXT.has(extname(opts.entry).toLowerCase())) {
    return (await import("../export-page.ts")).exportPage(opts);
  }
  const tts = createTTSEngine({ adapters: opts.ttsAdapters, cacheDir: opts.ttsCacheDir });
  // What prepareNarration returned, by its request, for the page to answer
  // with: it has no TTS server, and an estimate would put the timing off.
  const narration = new Map<string, unknown>();
  setTTSHook(async (body) => {
    const clips = (await tts.handle(body as Parameters<typeof tts.handle>[0])) as Record<string, { src: string }>;
    // The cache path means nothing in the page; the soundtrack carries the audio.
    const local = Object.fromEntries(Object.entries(clips).map(([k, c]) => [k, { ...c, src: "" }]));
    narration.set(JSON.stringify(body), local);
    return clips;
  });
  let entry;
  try {
    log(`Loading ${opts.entry} …`);
    entry = await loadCanvasEntry(opts.entry);
  } finally {
    setTTSHook(undefined);
  }
  // Not a canvas reel: a page, exported with Chrome.
  if (!entry) return (await import("../export-page.ts")).exportPage(opts);
  const { reel, dir } = entry;
  const tmp = await mkdtemp(join(tmpdir(), "kamishibai-export-"));
  try {
    // ---- paint every frame once, recording what the reel draws and reads
    const views: View[] = [resolveView(reel.meta, { pixelRatio: 0.25, medium: "player" })];
    if (reel.meta.aspect) {
      for (const aspect of [reel.meta.aspect.min, reel.meta.aspect.max]) views.push(resolveView(reel.meta, { aspect, pixelRatio: 0.25, medium: "player" }));
    }
    const chars = new Map<string, Set<string>>();
    recordText((font, text) => {
      for (const family of splitFontWeight(font)?.families ?? []) {
        let set = chars.get(family);
        if (!set) chars.set(family, (set = new Set()));
        for (const ch of text) set.add(ch);
      }
    });
    const reads: EnvReads = { texts: new Map(), images: new Map() };
    let frames = 0;
    try {
      await registerFonts(reel, dir);
      const env = await nodeEnv(dir, reads);
      const { createCanvas } = await loadSkia();
      const seen = new Set<string>();
      for (const view of views) {
        if (seen.has(viewKey(view))) continue;
        seen.add(viewKey(view));
        log(`Painting every frame at ${view.width}×${view.height} to learn what the reel draws…`);
        const paint = await reel.setup(view, env);
        const g = patchContext(createCanvas(Math.ceil(view.width * view.pixelRatio), Math.ceil(view.height * view.pixelRatio)).getContext("2d") as unknown as Context2D);
        const n = frameCount(reel.meta);
        for (let i = 0; i < n; i++) {
          g.reset?.();
          g.setTransform(view.pixelRatio, 0, 0, view.pixelRatio, 0, 0);
          paint(g, frameTimeMs(i, reel.meta.fps));
          frames++;
        }
      }
    } finally {
      recordText(undefined);
    }

    // ---- fonts, cut to the characters drawn in each family
    let subsetFont: typeof import("subset-font").default;
    try {
      subsetFont = (await import("subset-font")).default;
    } catch {
      throw new Error("export cuts fonts to the glyphs a reel draws with subset-font: npm i -D subset-font");
    }
    const fonts: Record<string, string> = {};
    let fontBytes = 0;
    for (const f of reel.fonts ?? []) {
      if (fonts[f.src]) continue;
      const used = chars.get(f.family);
      if (!used?.size) {
        log(`  (${f.family}: no text drawn in it — left out)`);
        continue;
      }
      const woff2 = await subsetFont(await readFile(resolve(dir, f.src)), [...used].join(""), { targetFormat: "woff2" });
      fontBytes += woff2.length;
      fonts[f.src] = dataUrl("font/woff2", woff2);
      log(`  ✓ ${f.family} (${f.src}): ${used.size} character(s), ${(woff2.length / 1024).toFixed(1)} KB`);
    }

    // ---- the files setup read
    const texts = Object.fromEntries(reads.texts);
    const images: Record<string, string> = {};
    let fileBytes = [...reads.texts.values()].reduce((n, t) => n + Buffer.byteLength(t), 0);
    for (const [path, file] of reads.images) {
      const bytes = await readFile(file);
      fileBytes += bytes.length;
      images[path] = dataUrl(MIME[extname(file).toLowerCase()] ?? "application/octet-stream", bytes);
    }

    // ---- the sound: mixed into one track, or the clips to play live
    const clips = (reel.audio ?? []).map((c) => {
      const near = resolve(dir, c.src);
      return c.src && !/^https?:\/\//i.test(c.src) && !isAbsolute(c.src) && existsSync(near) ? { ...c, src: near } : c;
    });
    const sound = await exportSound({ clips, mode: opts.audio ?? "mix", durationMs: reel.meta.durationMs, bitrate: opts.audioBitrate, tmp, log });

    // ---- the reel and the player, bundled for the page
    const prelude: Plugin = {
      name: "kamishibai-export-prelude",
      setup(b) {
        b.onResolve({ filter: /^kamishibai-export-prelude$/ }, () => ({ path: "prelude", namespace: "kamishibai-export" }));
        b.onLoad({ filter: /.*/, namespace: "kamishibai-export" }, () => ({
          // Runs before the reel's module: its prepareNarration is answered from the file.
          contents: `const data = JSON.parse(document.getElementById("kamishibai-data").textContent);
const lines = new Map(data.narration);
globalThis.__KAMISHIBAI_TTS__ = async (body) => {
  const clips = lines.get(JSON.stringify(body));
  if (!clips) throw new Error("this narration was not exported with the reel: run kamishibai export again");
  return clips;
};`,
          loader: "js",
        }));
      },
    };
    const { entryPoints: _, outfile: __, ...base } = bundleOptions(resolve(opts.entry), "bundle.js");
    const built = await build({
      ...base,
      write: false,
      minify: true,
      sourcemap: false,
      legalComments: "none",
      stdin: {
        contents: `import "kamishibai-export-prelude";
import reel from ${JSON.stringify(resolve(opts.entry))};
import { play, optionsFromQuery } from ${JSON.stringify(canvasModule())};
const data = JSON.parse(document.getElementById("kamishibai-data").textContent);
// The file's defaults, which the URL's query can change (?controls=0&loop=0&t=10 …).
const options = optionsFromQuery(location.search, { controls: !data.bare, loop: data.loop, autoplay: data.autoplay });
window.kamishibaiPlayer = await play(reel, document.getElementById("kamishibai"), {
  ...options, medium: data.bare ? "embed" : "player",
  texts: data.texts, images: data.images, fonts: data.fonts, soundtrack: data.soundtrack, liveAudio: data.liveAudio,
});`,
        resolveDir: dir,
        sourcefile: "kamishibai-export.js",
        loader: "js",
      },
      plugins: [...(base.plugins ?? []), prelude],
    });
    const js = built.outputFiles[0]!.text;
    const loop = opts.loop === undefined || opts.loop === -1 ? false : opts.loop === 0 ? true : opts.loop;

    const data = { bare: !!opts.bare, loop, autoplay: opts.autoplay === false ? false : undefined, texts, images, fonts, soundtrack: sound.soundtrack, liveAudio: sound.liveAudio, narration: [...narration] };
    const bytes = await writeExportHtml({ out: opts.out, title: reel.meta.title ?? basename(opts.entry), bare: !!opts.bare, data, js });
    return { out: resolve(opts.out), bytes, parts: { script: js.length, fonts: fontBytes, files: fileBytes, soundtrack: sound.bytes }, frames };
  } finally {
    await entry.close();
    await rm(tmp, { recursive: true, force: true });
  }
}
