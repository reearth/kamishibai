// `kamishibai export` for a page reel (window.kamishibai): the page and a
// player in one HTML file that plays with no server.
// ------------------------------------------------------------------
// The page is served as for a capture and seeked through every frame once in
// Chrome, with no screenshots. Meanwhile the files it reads from its server
// are recorded, and so are its narration answers and its audio and subtitle
// markers. The file carries them: export-prelude.ts serves the files and the
// narration back to the page, and the player calls seek(ms) as it plays.
// ------------------------------------------------------------------
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "esbuild";
import { GLOBAL_KEY, frameCount, type KamishibaiMeta } from "./protocol.ts";
import { launchChrome, waitForReel } from "./renderer.ts";
import { SCRIPT_EXT, bundleOptions, serveEntry } from "./serve.ts";
import { assertFfmpeg, mixAudio } from "./ffmpeg.ts";
import { prepareAudio } from "./render.ts";
import { mergeCues, type Cue } from "./subtitle.ts";
import { createTTSEngine } from "./tts/engine.ts";
import type { AudioClip } from "./audio.ts";
import { writeExportHtml } from "./export-html.ts";
import type { ExportOptions, ExportResult } from "./canvas/export.ts";

/** A browser module: built next to this one (dist), or its source. */
function moduleFile(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const built = join(here, `${name}.js`);
  return existsSync(built) ? built : join(here, `${name}.ts`);
}

/** Requests the page makes to the server that aren't the page's own files. */
const SERVED_BY_KAMISHIBAI = new Set(["/", "/index.html", "/bundle.js", "/favicon.ico"]);

export async function exportPage(opts: ExportOptions): Promise<ExportResult> {
  const log = opts.onLog ?? (() => {});
  if (/^https?:\/\//i.test(opts.entry) || !SCRIPT_EXT.has(extname(opts.entry).toLowerCase())) {
    throw new Error(`export needs a script entry (.ts/.tsx/.js/.jsx): a canvas reel, or a page that sets window.kamishibai`);
  }
  const entry = resolve(opts.entry);
  const tts = createTTSEngine({ adapters: opts.ttsAdapters, cacheDir: opts.ttsCacheDir });
  const narration = new Map<string, unknown>();
  const served = await serveEntry(entry, {
    publicDir: opts.publicDir,
    tts: async (body) => {
      const clips = (await tts.handle(body as Parameters<typeof tts.handle>[0])) as Record<string, { src: string }>;
      // The page posts JSON; the prelude looks the request up by the same JSON.
      narration.set(JSON.stringify(body), Object.fromEntries(Object.entries(clips).map(([k, c]) => [k, { ...c, src: "" }])));
      return clips;
    },
  });
  const origin = new URL(served.url).origin;
  const files: Record<string, [string, string]> = {};
  let fileBytes = 0;
  const reads: Promise<void>[] = [];
  const browser = await launchChrome();
  const tmp = await mkdtemp(join(tmpdir(), "kamishibai-export-"));
  let meta: KamishibaiMeta;
  let markers: { audio: AudioClip[]; subtitles: Cue[] };
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on("response", (res) => {
      const url = new URL(res.url());
      if (url.origin !== origin || res.request().method() !== "GET" || res.status() !== 200) return;
      const path = url.pathname + url.search;
      if (SERVED_BY_KAMISHIBAI.has(url.pathname) || url.pathname.startsWith("/__")) return;
      reads.push(
        res.body().then(
          (body) => {
            if (files[path]) return;
            fileBytes += body.length;
            files[path] = [res.headers()["content-type"] ?? "application/octet-stream", body.toString("base64")];
          },
          () => {},
        ),
      );
    });
    log(`Loading ${opts.entry} in Chrome…`);
    await page.goto(served.url, { waitUntil: "networkidle" });
    await waitForReel(page, { busy: () => tts.busy(), timeoutMs: opts.probeTimeoutMs });
    await page.evaluate(() => document.fonts.ready);
    meta = (await page.evaluate((key) => (window as any)[key].meta, GLOBAL_KEY)) as KamishibaiMeta;
    // Every frame once, in the page: what it fetches at some moment (a video
    // clip, a picture for one scene) is recorded too.
    const n = frameCount(meta);
    log(`Seeking through ${n} frames to record what the page reads…`);
    await page.evaluate(
      async ([key, n, fps]) => {
        const k = (window as any)[key];
        for (let i = 0; i < n; i++) await k.seek((i * 1000) / fps);
      },
      [GLOBAL_KEY, n, meta.fps] as const,
    );
    await page.waitForLoadState("networkidle");
    markers = (await page.evaluate((key) => {
      const k = (window as any)[key];
      return { audio: Array.isArray(k.audio) ? k.audio : [], subtitles: Array.isArray(k.subtitles) ? k.subtitles : [] };
    }, GLOBAL_KEY)) as typeof markers;
    await Promise.all(reads);
  } finally {
    await browser.close();
    await served.close();
  }
  try {
    for (const path of Object.keys(files)) log(`  ✓ ${path} (${files[path]![0]}, ${(Buffer.from(files[path]![1], "base64").length / 1024).toFixed(1)} KB)`);

    // The soundtrack, mixed into one track as for an mp4.
    let soundtrack: string | undefined;
    let audioBytes = 0;
    if (markers.audio.length) {
      await assertFfmpeg();
      const kept = await prepareAudio(markers.audio, opts.publicDir, meta.durationMs, log);
      if (kept.length) {
        const m4a = join(tmp, "soundtrack.m4a");
        log(`Mixing ${kept.length} audio clip(s) into one track…`);
        await mixAudio({ clips: kept, out: m4a, durationMs: meta.durationMs, bitrate: opts.audioBitrate });
        const bytes = await readFile(m4a);
        audioBytes = bytes.length;
        soundtrack = `data:audio/mp4;base64,${bytes.toString("base64")}`;
      }
    }

    const { entryPoints: _, outfile: __, ...base } = bundleOptions(entry, "bundle.js");
    const prelude = moduleFile("export-prelude");
    // The page and the prelude are imported for what they do, not for exports,
    // which "sideEffects": false in a package.json would let esbuild drop.
    const keep: Plugin = {
      name: "kamishibai-export-side-effects",
      setup(b) {
        b.onResolve({ filter: /.*/ }, (args) => (args.path === entry || args.path === prelude ? { path: args.path, sideEffects: true } : undefined));
      },
    };
    const built = await build({
      ...base,
      write: false,
      minify: true,
      sourcemap: false,
      legalComments: "none",
      stdin: {
        contents: `import ${JSON.stringify(prelude)};
import ${JSON.stringify(entry)};
import { playPage, optionsFromQuery } from ${JSON.stringify(moduleFile("player"))};
const data = JSON.parse(document.getElementById("kamishibai-data").textContent);
// The file's defaults, which the URL's query can change (?controls=0&loop=0&t=10 …).
const options = optionsFromQuery(location.search, { controls: !data.bare, loop: data.loop, autoplay: data.autoplay });
window.kamishibaiPlayer = await playPage(document.getElementById("kamishibai"), document.getElementById("kamishibai-root"), {
  ...options, soundtrack: data.soundtrack, subtitles: data.subtitles,
});`,
        resolveDir: dirname(entry),
        sourcefile: "kamishibai-export.js",
        loader: "js",
      },
      plugins: [keep],
    });
    const js = built.outputFiles[0]!.text;
    const loop = opts.loop === undefined || opts.loop === -1 ? false : opts.loop === 0 ? true : opts.loop;
    const data = {
      bare: !!opts.bare,
      loop,
      autoplay: opts.autoplay === false ? false : undefined,
      soundtrack,
      subtitles: mergeCues(markers.subtitles),
      narration: [...narration],
      files,
    };
    const bytes = await writeExportHtml({ out: opts.out, title: basename(opts.entry), bare: !!opts.bare, data, js, pageRoot: true });
    return { out: resolve(opts.out), bytes, parts: { script: js.length, fonts: 0, files: fileBytes, soundtrack: audioBytes }, frames: frameCount(meta) };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
