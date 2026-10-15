#!/usr/bin/env node
// kamishibai CLI
// ------------------------------------------------------------------
//   kamishibai render  <entry|url> [options]   capture + encode
//   kamishibai capture <entry|url> -f <dir>    frames only
//   kamishibai encode  -f <dir> [options]      frames -> video
//   kamishibai tts     <entry>                 narration pre-pass only
//   kamishibai dev     <entry>                 live preview in the browser
//   kamishibai skill [topic…|all]              print the usage guide
//
// HELP below is the option reference; FLAGS_FOR says which subcommand
// honors which flag (the rest are ignored with a warning).
// ------------------------------------------------------------------
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { render, encode, capture, synthesize } from "./render.ts";
import { exportHtml } from "./canvas/export.ts";
import { dev, CC_MODES, type CcMode } from "./dev/server.ts";
import { loadTTSAdapters } from "./tts/load.ts";
import { parseAspect, parseInsets } from "./canvas/types.ts";
import SKILL from "./skill.md";
import { skillText } from "./skill.ts";

const HELP = `kamishibai — seek a web page frame by frame and bake it into an mp4.

Usage:
  kamishibai render <entry|url> [options]        capture + encode (the usual one)
  kamishibai capture <entry|url> -f <dir> [opts] capture frames only, no encode
  kamishibai encode -f <frames-dir> [options]    re-encode kept frames, no capture
  kamishibai tts <entry> [options]               bake narration into the TTS cache only
  kamishibai dev <entry> [options]               live preview in the browser
  kamishibai export <entry> -o reel.html         a reel and its player as one HTML
                                                 file that plays with no server
  kamishibai skill [topic…|all]                  print the usage guide: the core and a
                                                 topic list, the named topics, or all

Arguments:
  <entry|url>           a URL, an .html file, or a script (.ts/.tsx/.js/.jsx)
                        that exposes window.kamishibai = { meta, seek(ms) }.
                        A URL is loaded as-is: -p, --burn-subtitles and
                        narration (TTS) need a script or .html entry.
                        A script whose default export is a canvas reel
                        ({ meta, setup }, kamishibai/canvas) is painted on the
                        CPU, with no browser.

Capture options (render, capture):
  -w, --workers <n>     parallel capture pages (default: ~cpus-2, max 8)
      --fps <n>         override the page's fps (re-samples the same reel)
  -s, --scale <n>       device scale factor; output px = meta size × scale (default: 1)
  -p, --public <dir>    static assets dir served at the root (staticFile paths);
                        the entry's own files win on a name clash (also: tts)
  -f, --frames-dir <d>  write PNG frames here (created if needed; kept after)
  -i, --incremental     reuse cached frames; re-render only changed ones
                        (needs --frames-dir; compares per-frame fingerprints)
      --only <ranges>   render only these frames, e.g. 0-30,90,120-150
                        (needs --frames-dir with a prior full render)
      --burn-subtitles  burn captions into the frames (pixels) instead of the
                        default soft mp4 track + sidecar .srt (needed for gif)
      --probe-timeout <s>
                        seconds to wait for the page to expose window.kamishibai
                        with nothing in progress (default: 15); narration still
                        synthesizing doesn't count against it (also: tts)
      --tts-adapter <file>
                        a module (.ts/.js) whose default export is a custom
                        TTSAdapter, or an array of them; the reel picks one by
                        its provider. Repeatable (also: tts)

Canvas reel options (render, capture):
      --size <w>x<h>    the view's size in layout units (default: meta's)
      --aspect <w:h>    the view's shape, e.g. 9:16; the long side keeps meta's
                        (within the reel's meta.aspect)
      --inset <t,r,b,l> space to keep clear of, in layout units (one number
                        for all sides), e.g. for an app's controls over the video
      --renderer <r>    where frames are drawn: auto (default: a canvas reel in
                        Node, anything else in Chrome), node (Skia, no browser;
                        needs a canvas reel), or chrome (a canvas reel is
                        mounted in a page)

Encode options (render, encode):
  -o, --out <file>      output file; .mp4 (default) or .gif by extension
  -f, --frames-dir <d>  (encode) the frames dir to read; fps, audio and
                        subtitles come from its manifest + mux sidecar
      --fps <n>         (encode) play the kept frames at this rate instead of
                        the manifest's — a speed change, not a re-sample
      --max-width <n>   downscale the output (mp4 or gif) to at most n px wide
      --gif-loop <n>    gif loops: 0 = infinite (default), -1 = once, n = times
      --crf <n>         H.264 quality 0-51, lower = better (default: 18)
      --preset <name>   libx264 speed/compression preset (ultrafast … veryslow);
                        ultrafast speeds up the mp4 encode for quick confirms
      --preview         shortcut for --preset ultrafast (fast confirm encode)
      --encode-args <s> extra ffmpeg args for the video encode pass, e.g.
                        --encode-args "-tune animation" (mp4 only)
      --mux-args <s>    extra ffmpeg args for the audio/subtitle mux pass, e.g.
                        --mux-args "-movflags +faststart" (mp4 only)
      --verbose         stream ffmpeg output

Export options (export):
  -o, --out <file>      the HTML file to write (default: reel.html)
      --bare            no controls: a canvas that autoplays, to embed in a page
                        (its handle is window.kamishibaiPlayer)
      --loop <n>        play again from the start, as --gif-loop: 0 = forever,
                        -1 = once (default), n = n more times
      --no-autoplay     wait for the viewer (or the page) to start it
                        These set the file's defaults; its URL can change them:
                        ?controls=0|1 &autoplay=0|1 &loop=<n> &t=<s> &muted=1
  -p, --public <dir>, --probe-timeout <s>, --tts-adapter <file>
                        as for render (a page reel is recorded in Chrome)

Dev options (dev):
  -p, --public <dir>    static assets dir served at the root, as in render
      --port <n>        port to listen on (default: 4321; a free one if taken)
      --mute            start the player muted
      --cc <mode>       the player's starting overlay: off; captions (the soft
                        subtitles); storyboard (also every sound as text). The
                        player remembers its last.
      --no-sweep        don't seek every frame in the background to collect
                        the sound up front (for a heavy reel)
      --no-open         don't open the browser
                        dev never calls a TTS provider: cached lines play,
                        new ones get an estimated length. Bake them with tts.

Other:
      --keep-frames     (render) keep the intermediate PNG frames
  -h, --help            show this help

A flag the chosen subcommand doesn't use is ignored, with a warning.

Examples:
  kamishibai render reel.tsx -o reel.mp4 -w 4
  kamishibai render reel.tsx -s 2 -o reel@2x.mp4
  kamishibai render http://localhost:3000 -o page.mp4
  kamishibai render reel.tsx -p public -o reel.mp4
  kamishibai render reel.tsx -f frames -o reel.mp4            # seed the cache
  kamishibai render reel.tsx -f frames -i -o reel.mp4         # incremental rebuild
  kamishibai render reel.tsx -f frames -i --preview -o reel.mp4   # fast confirm
  kamishibai render reel.tsx -f frames --only 0-30 -o reel.mp4
  kamishibai capture reel.tsx -f frames --only 0-30           # check frames, no mp4
  kamishibai capture reel.tsx -f frames                       # capture frames only
  kamishibai encode -f frames -o reel.mp4                     # then encode them
  kamishibai encode -f frames --preview -o preview.mp4        # fast, no capture
  kamishibai tts reel.tsx                                     # synthesize narration first
  kamishibai tts reel.tsx --tts-adapter kokoro.ts             # with a custom TTS adapter
  kamishibai dev reel.tsx -p public                           # preview while editing
  kamishibai skill                                            # core guide + topic list
  kamishibai skill audio narration                            # two topics
  kamishibai skill all > kamishibai.md                        # the whole guide
`;

const CAPTURE_FLAGS = [
  "workers", "fps", "scale", "public", "frames-dir", "incremental", "only",
  "burn-subtitles", "probe-timeout", "tts-adapter", "size", "aspect", "inset", "renderer",
];
const ENCODE_FLAGS = [
  "out", "frames-dir", "fps", "max-width", "gif-loop", "crf", "preset", "preview",
  "encode-args", "mux-args", "verbose",
];
/** The flags each subcommand actually reads (keep in sync with main()). */
const FLAGS_FOR: Record<string, Set<string>> = {
  render: new Set([...CAPTURE_FLAGS, ...ENCODE_FLAGS, "keep-frames"]),
  capture: new Set(CAPTURE_FLAGS),
  encode: new Set(ENCODE_FLAGS),
  tts: new Set(["public", "probe-timeout", "tts-adapter"]),
  dev: new Set(["public", "port", "mute", "cc", "no-sweep", "no-open"]),
  export: new Set(["out", "bare", "loop", "no-autoplay", "public", "probe-timeout", "tts-adapter"]),
};

// libx264's speed presets, slowest-compressing last. Validated so a typo fails
// fast with a helpful message instead of ffmpeg erroring out mid-encode.
const X264_PRESETS = [
  "ultrafast", "superfast", "veryfast", "faster", "fast",
  "medium", "slow", "slower", "veryslow", "placebo",
];

/**
 * Pull a raw passthrough option (and its value) out of an argv list before it
 * reaches parseArgs, which otherwise rejects a value starting with "-" (nearly
 * every ffmpeg flag, and a negative number) unless written as `--opt=…`.
 * Supports both `--name value` and `--name=value`; returns the value and the
 * argv with both tokens removed. A trailing `--name` with no value is an error.
 */
function takeRawOption(argv: string[], name: string): { value?: string; rest: string[] } {
  const rest: string[] = [];
  const eq = `--${name}=`;
  let value: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === `--${name}`) {
      // the next token is the value, even if it starts with "-"
      if (i + 1 >= argv.length) throw new Error(`--${name} needs a value`);
      value = argv[++i];
    }
    else if (a.startsWith(eq)) value = a.slice(eq.length);
    else rest.push(a);
  }
  return { value, rest };
}

/** Open `url` in the default browser; a failure only means the user opens it. */
function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  } catch {
    /* no opener: the URL is printed above */
  }
}

async function main(): Promise<void> {
  // Extract the options whose values may start with "-" first (ffmpeg flags,
  // `--gif-loop -1`) since they confuse parseArgs, then parse the rest as usual.
  const enc = takeRawOption(process.argv.slice(2), "encode-args");
  const mux = takeRawOption(enc.rest, "mux-args");
  const loop = takeRawOption(mux.rest, "gif-loop");
  // export's --loop takes the same values, -1 included.
  const htmlLoop = takeRawOption(loop.rest, "loop");

  const { values, positionals } = parseArgs({
    args: htmlLoop.rest,
    allowPositionals: true,
    options: {
      out: { type: "string", short: "o" },
      workers: { type: "string", short: "w" },
      fps: { type: "string" },
      scale: { type: "string", short: "s" },
      public: { type: "string", short: "p" },
      "frames-dir": { type: "string", short: "f" },
      incremental: { type: "boolean", short: "i" },
      only: { type: "string" },
      "max-width": { type: "string" },
      crf: { type: "string" },
      preset: { type: "string" },
      preview: { type: "boolean" },
      "keep-frames": { type: "boolean" },
      "burn-subtitles": { type: "boolean" },
      "probe-timeout": { type: "string" },
      "tts-adapter": { type: "string", multiple: true },
      size: { type: "string" },
      aspect: { type: "string" },
      inset: { type: "string" },
      renderer: { type: "string" },
      bare: { type: "boolean" },
      "no-autoplay": { type: "boolean" },
      verbose: { type: "boolean" },
      port: { type: "string" },
      mute: { type: "boolean" },
      cc: { type: "string" },
      "no-sweep": { type: "boolean" },
      "no-open": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  const [command, entry] = positionals;

  // `kamishibai skill` (alias: skills) prints the usage guide for an agent's
  // context: the core and a topic list, or the named topics, or `all`.
  if (command === "skill" || command === "skills") {
    try {
      process.stdout.write(skillText(SKILL, positionals.slice(1)));
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
    return;
  }

  if (values.help || positionals.length === 0) {
    process.stdout.write(HELP);
    process.exit(values.help ? 0 : 1);
  }

  if (!command || !FLAGS_FOR[command]) {
    process.stderr.write(
      `Unknown command "${command}". Try: kamishibai render <entry|url>  (or: capture / tts / dev / export / encode -f <frames-dir>)\n`,
    );
    process.exit(1);
  }

  const workers = values.workers ? Number(values.workers) : undefined;
  const fps = values.fps ? Number(values.fps) : undefined;
  const scale = values.scale ? Number(values.scale) : undefined;
  const maxWidth = values["max-width"] ? Number(values["max-width"]) : undefined;
  const gifLoop = loop.value != null ? Number(loop.value) : undefined;
  const crf = values.crf ? Number(values.crf) : undefined;
  const probeTimeout = values["probe-timeout"] ? Number(values["probe-timeout"]) : undefined;
  if (probeTimeout !== undefined && (!Number.isFinite(probeTimeout) || probeTimeout <= 0)) {
    throw new Error(`--probe-timeout must be a positive number of seconds, got "${values["probe-timeout"]}"`);
  }
  const probeTimeoutMs = probeTimeout !== undefined ? probeTimeout * 1000 : undefined;
  if (workers !== undefined && (!Number.isInteger(workers) || workers < 1)) {
    throw new Error(`--workers must be a positive integer, got "${values.workers}"`);
  }
  if (scale !== undefined && (!Number.isFinite(scale) || scale <= 0)) {
    throw new Error(`--scale must be a positive number, got "${values.scale}"`);
  }
  if (fps !== undefined && (!Number.isFinite(fps) || fps <= 0)) {
    throw new Error(`--fps must be a positive number, got "${values.fps}"`);
  }
  if (maxWidth !== undefined && (!Number.isFinite(maxWidth) || maxWidth <= 0)) {
    throw new Error(`--max-width must be a positive number, got "${values["max-width"]}"`);
  }
  // Checked here, not by ffmpeg, so a typo fails before a long capture.
  if (crf !== undefined && (!Number.isFinite(crf) || crf < 0 || crf > 51)) {
    throw new Error(`--crf must be a number from 0 to 51, got "${values.crf}"`);
  }
  if (gifLoop !== undefined && (!Number.isInteger(gifLoop) || gifLoop < -1)) {
    throw new Error(`--gif-loop must be an integer ≥ -1 (0 = infinite, -1 = once), got "${loop.value}"`);
  }

  // Say so when a flag is given that this subcommand never reads.
  const given = Object.keys(values).filter((k) => values[k as keyof typeof values] !== undefined);
  if (enc.value !== undefined) given.push("encode-args");
  if (mux.value !== undefined) given.push("mux-args");
  if (loop.value !== undefined) given.push("gif-loop");
  if (htmlLoop.value !== undefined) given.push("loop");
  const ignored = given.filter((k) => !FLAGS_FOR[command]!.has(k));
  if (ignored.length > 0) {
    process.stderr.write(
      `kamishibai ${command}: ignoring ${ignored.map((k) => `--${k}`).join(", ")} (not used by ${command}; see --help)\n`,
    );
  }
  // A URL entry is a page you serve, so kamishibai can't add assets or flags to it.
  if (entry && /^https?:\/\//i.test(entry)) {
    const unreachable = (["public", "burn-subtitles"] as const).filter(
      (k) => values[k] !== undefined && FLAGS_FOR[command]!.has(k),
    );
    if (unreachable.length > 0) {
      process.stderr.write(
        `kamishibai: ${unreachable.map((k) => `--${k}`).join(", ")} ${unreachable.length > 1 ? "have" : "has"} no effect on a URL entry (serve the assets / set the flag yourself)\n`,
      );
    }
  }

  // A canvas reel's view: checked here, so a typo fails before anything loads.
  const sizeMatch = values.size !== undefined ? /^(\d+)x(\d+)$/.exec(values.size) : undefined;
  if (values.size !== undefined && !sizeMatch) {
    throw new Error(`--size must be <width>x<height> in layout units, e.g. 1080x1920, got "${values.size}"`);
  }
  const size = sizeMatch ? { width: Number(sizeMatch[1]), height: Number(sizeMatch[2]) } : undefined;
  if (values.aspect !== undefined) parseAspect(values.aspect);
  if (size && values.aspect !== undefined) throw new Error(`pass --size or --aspect, not both`);
  const insets = values.inset !== undefined ? parseInsets(values.inset) : undefined;
  const renderer = values.renderer as "auto" | "node" | "chrome" | undefined;
  if (renderer !== undefined && !["auto", "node", "chrome"].includes(renderer)) {
    throw new Error(`--renderer must be auto, node or chrome, got "${values.renderer}"`);
  }
  const view = { size, aspect: values.aspect, insets, renderer };

  // --preview is sugar for --preset ultrafast; an explicit --preset wins.
  const preset = values.preset ?? (values.preview ? "ultrafast" : undefined);
  if (preset !== undefined && !X264_PRESETS.includes(preset)) {
    throw new Error(`--preset must be one of ${X264_PRESETS.join(", ")}, got "${preset}"`);
  }

  // Raw ffmpeg passthrough, split on whitespace (so quote the whole string).
  // Kept separate for the encode and mux passes since they differ in nature
  // (H.264 compression vs. stream-copy mux).
  const splitArgs = (s: string | undefined) => (s?.trim() ? s.trim().split(/\s+/) : undefined);
  const encodeArgs = splitArgs(enc.value);
  const muxArgs = splitArgs(mux.value);

  // `kamishibai dev` serves the reel with a player and rebuilds it on save,
  // until interrupted.
  if (command === "dev") {
    if (!entry) {
      process.stderr.write(`Missing <entry>.\n\n${HELP}`);
      process.exit(1);
    }
    const port = values.port !== undefined ? Number(values.port) : undefined;
    if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) {
      throw new Error(`--port must be an integer from 0 to 65535, got "${values.port}"`);
    }
    const cc = values.cc as CcMode | undefined;
    if (cc !== undefined && !CC_MODES.includes(cc)) {
      throw new Error(`--cc must be one of ${CC_MODES.join(", ")}, got "${values.cc}"`);
    }
    const server = await dev({
      entry,
      publicDir: values.public,
      port,
      mute: values.mute,
      cc,
      sweep: !values["no-sweep"],
      onLog: (msg) => process.stderr.write(`${msg}\n`),
    });
    process.stderr.write(`kamishibai dev → ${server.url}  (Ctrl+C to stop)\n`);
    if (!values["no-open"]) openBrowser(server.url);
    const stop = () => {
      void server.close().then(() => process.exit(0));
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    return;
  }

  // Custom TTS adapters, for the commands that synthesize (dev never does).
  const ttsAdapters =
    values["tts-adapter"] && FLAGS_FOR[command]!.has("tts-adapter")
      ? await loadTTSAdapters(values["tts-adapter"])
      : undefined;

  // `kamishibai tts` runs only the narration pre-pass: load the page once so
  // its prepareNarration fills the cache, then stop — no capture, no encode.
  if (command === "tts") {
    if (!entry) {
      process.stderr.write(`Missing <entry>.\n\n${HELP}`);
      process.exit(1);
    }
    const res = await synthesize({
      entry,
      publicDir: values.public,
      probeTimeoutMs,
      ttsAdapters,
      onLog: (msg) => process.stderr.write(`${msg}\n`),
    });
    process.stderr.write(`Narration cache → ${res.cacheDir}\n`);
    if (res.failed > 0) process.exit(1);
    return;
  }

  // `kamishibai capture` captures frames into a dir WITHOUT encoding — pair it
  // with `kamishibai encode` to split a render into its two halves.
  if (command === "export") {
    if (!entry) {
      process.stderr.write(`Missing <entry>.\n\n${HELP}`);
      process.exit(1);
    }
    const htmlLoops = htmlLoop.value != null ? Number(htmlLoop.value) : undefined;
    if (htmlLoops !== undefined && (!Number.isInteger(htmlLoops) || htmlLoops < -1)) {
      throw new Error(`--loop must be an integer ≥ -1 (0 = forever, -1 = once), got "${htmlLoop.value}"`);
    }
    const r = await exportHtml({
      entry,
      out: values.out ?? "reel.html",
      bare: values.bare,
      loop: htmlLoops,
      autoplay: values["no-autoplay"] ? false : undefined,
      publicDir: values.public,
      probeTimeoutMs,
      ttsAdapters,
      onLog: (msg) => process.stderr.write(`${msg}\n`),
    });
    const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
    process.stderr.write(
      `Done → ${r.out} (${kb(r.bytes)}: script ${kb(r.parts.script)}, fonts ${kb(r.parts.fonts)}` +
        `${r.parts.files ? `, files ${kb(r.parts.files)}` : ""}${r.parts.soundtrack ? `, soundtrack ${kb(r.parts.soundtrack)}` : ""})\n`,
    );
    return;
  }

  if (command === "capture") {
    if (!entry) {
      process.stderr.write(`Missing <entry|url>.\n\n${HELP}`);
      process.exit(1);
    }
    const framesDir = values["frames-dir"];
    if (!framesDir) {
      process.stderr.write(`capture needs a frames dir — pass -f/--frames-dir <dir>.\n`);
      process.exit(1);
    }
    const cap = await capture({
      entry,
      framesDir,
      fps,
      workers,
      scale,
      publicDir: values.public,
      incremental: values.incremental,
      only: values.only,
      burnSubtitles: values["burn-subtitles"],
      probeTimeoutMs,
      ttsAdapters,
      ...view,
      onLog: (msg) => process.stderr.write(`${msg}\n`),
    });
    process.stderr.write(`Captured ${cap.frames} frame(s) → ${cap.framesDir}\n`);
    return;
  }

  // `kamishibai encode` re-assembles a frames dir into a video without
  // re-capturing — no entry, no browser. fps/audio/subtitles come from the dir.
  if (command === "encode") {
    const framesDir = values["frames-dir"];
    if (!framesDir) {
      process.stderr.write(`encode needs a frames dir — pass -f/--frames-dir <dir>.\n`);
      process.exit(1);
    }
    await encode({
      framesDir,
      out: values.out ?? "out.mp4",
      fps,
      maxWidth,
      gifLoop,
      crf,
      preset,
      encodeArgs,
      muxArgs,
      verbose: values.verbose,
      onLog: (msg) => process.stderr.write(`${msg}\n`),
    });
    return;
  }

  if (!entry) {
    process.stderr.write(`Missing <entry|url>.\n\n${HELP}`);
    process.exit(1);
  }

  await render({
    entry,
    out: values.out ?? "out.mp4",
    workers,
    fps,
    scale,
    maxWidth,
    gifLoop,
    publicDir: values.public,
    framesDir: values["frames-dir"],
    incremental: values.incremental,
    only: values.only,
    burnSubtitles: values["burn-subtitles"],
    crf,
    preset,
    encodeArgs,
    muxArgs,
    keepFrames: values["keep-frames"],
    probeTimeoutMs,
    ttsAdapters,
    ...view,
    verbose: values.verbose,
    onLog: (msg) => process.stderr.write(`${msg}\n`),
  });
}

main().catch((err) => {
  process.stderr.write(`\nkamishibai: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
