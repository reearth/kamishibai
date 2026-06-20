#!/usr/bin/env node
// kamishibai CLI
// ------------------------------------------------------------------
//   kamishibai render <entry|url> [options]
//
//   --out, -o <file>      output mp4 (default: out.mp4)
//   --workers, -w <n>     parallel Chrome instances (default: ~cpus-2)
//   --crf <n>             H.264 quality, lower = better (default: 18)
//   --keep-frames         keep intermediate PNG frames
//   --verbose             stream ffmpeg output
//   --help, -h            show this help
// ------------------------------------------------------------------
import { parseArgs } from "node:util";
import { render, encode, capture } from "./render.ts";
import SKILL from "./skill.md";

const HELP = `kamishibai — seek a web page frame by frame and bake it into an mp4.

Usage:
  kamishibai render <entry|url> [options]        capture + encode (the usual one)
  kamishibai capture <entry|url> -f <dir> [opts] capture frames only, no encode
  kamishibai encode -f <frames-dir> [options]    re-encode kept frames, no capture
  kamishibai skill                    print the full usage guide (markdown)

Arguments:
  <entry|url>           a URL, an .html file, or a script (.ts/.tsx/.js/.jsx)
                        that exposes window.kamishibai = { meta, seek(ms) }

Options:
  -o, --out <file>      output file; .mp4 (default) or .gif by extension
  -w, --workers <n>     parallel Chrome instances (default: ~cpus-2, max 8)
      --fps <n>         override the page's fps (re-samples the same reel)
  -s, --scale <n>       device scale factor; output px = meta size × scale (default: 1)
  -p, --public <dir>    static assets dir served at the root (staticFile paths)
  -f, --frames-dir <d>  write PNG frames here (created if needed; kept after)
  -i, --incremental     reuse cached frames; re-render only changed ones
                        (needs --frames-dir; compares per-frame fingerprints)
      --only <ranges>   render only these frames, e.g. 0-30,90,120-150
                        (needs --frames-dir with a prior full render)
      --burn-subtitles  burn captions into the frames (pixels) instead of the
                        default soft mp4 track + sidecar .srt (needed for gif)
      --max-width <n>   downscale the output (mp4 or gif) to at most n px wide
      --gif-loop <n>    gif loops: 0 = infinite (default), -1 = once, n = times
      --crf <n>         H.264 quality, lower = better (default: 18)
      --preset <name>   libx264 speed/compression preset (ultrafast … veryslow);
                        ultrafast speeds up the mp4 encode for quick confirms
      --preview         shortcut for --preset ultrafast (fast confirm encode)
      --encode-args <s> extra ffmpeg args for the video encode pass, e.g.
                        --encode-args "-tune animation" (mp4 only)
      --mux-args <s>    extra ffmpeg args for the audio/subtitle mux pass, e.g.
                        --mux-args "-movflags +faststart" (mp4 only)
      --keep-frames     keep the intermediate PNG frames
      --verbose         stream ffmpeg output
  -h, --help            show this help

Examples:
  kamishibai render reel.tsx -o reel.mp4 -w 4
  kamishibai render reel.tsx -s 2 -o reel@2x.mp4
  kamishibai render http://localhost:3000 -o page.mp4
  kamishibai render reel.tsx -p public -o reel.mp4
  kamishibai render reel.tsx -f frames -o reel.mp4            # seed the cache
  kamishibai render reel.tsx -f frames -i -o reel.mp4         # incremental rebuild
  kamishibai render reel.tsx -f frames -i --preview -o reel.mp4   # fast confirm
  kamishibai render reel.tsx -f frames --only 0-30 -o reel.mp4
  kamishibai capture reel.tsx -f frames                       # capture frames only
  kamishibai encode -f frames -o reel.mp4                     # then encode them
  kamishibai encode -f frames --preview -o preview.mp4        # fast, no capture
  kamishibai skill > kamishibai.md
`;

// libx264's speed presets, slowest-compressing last. Validated so a typo fails
// fast with a helpful message instead of ffmpeg erroring out mid-encode.
const X264_PRESETS = [
  "ultrafast", "superfast", "veryfast", "faster", "fast",
  "medium", "slow", "slower", "veryslow", "placebo",
];

/**
 * Pull a raw passthrough option (and its value) out of an argv list before it
 * reaches parseArgs, which otherwise rejects a value starting with "-" (nearly
 * every ffmpeg flag) unless written as `--opt=…`. Supports both `--name value`
 * and `--name=value`; returns the value and the argv with both tokens removed.
 */
function takeRawOption(argv: string[], name: string): { value?: string; rest: string[] } {
  const rest: string[] = [];
  const eq = `--${name}=`;
  let value: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === `--${name}`) value = argv[++i]; // next token is the value, even if it starts with "-"
    else if (a.startsWith(eq)) value = a.slice(eq.length);
    else rest.push(a);
  }
  return { value, rest };
}

async function main(): Promise<void> {
  // Extract the raw ffmpeg-passthrough options first (their dash-prefixed values
  // confuse parseArgs), then hand the rest to parseArgs as usual.
  const enc = takeRawOption(process.argv.slice(2), "encode-args");
  const mux = takeRawOption(enc.rest, "mux-args");

  const { values, positionals } = parseArgs({
    args: mux.rest,
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
      "gif-loop": { type: "string" },
      crf: { type: "string" },
      preset: { type: "string" },
      preview: { type: "boolean" },
      "keep-frames": { type: "boolean" },
      "burn-subtitles": { type: "boolean" },
      verbose: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  const [command, entry] = positionals;

  // `kamishibai skill` (alias: skills) prints the usage guide verbatim — meant
  // to be piped into an agent's context or saved as a file.
  if (command === "skill" || command === "skills") {
    process.stdout.write(SKILL);
    return;
  }

  if (values.help || positionals.length === 0) {
    process.stdout.write(HELP);
    process.exit(values.help ? 0 : 1);
  }

  if (command !== "render" && command !== "encode" && command !== "capture") {
    process.stderr.write(
      `Unknown command "${command}". Try: kamishibai render <entry|url>  (or: capture / encode -f <frames-dir>)\n`,
    );
    process.exit(1);
  }

  const workers = values.workers ? Number(values.workers) : undefined;
  const fps = values.fps ? Number(values.fps) : undefined;
  const scale = values.scale ? Number(values.scale) : undefined;
  const maxWidth = values["max-width"] ? Number(values["max-width"]) : undefined;
  const gifLoop = values["gif-loop"] != null ? Number(values["gif-loop"]) : undefined;
  const crf = values.crf ? Number(values.crf) : undefined;
  if (workers !== undefined && (!Number.isFinite(workers) || workers < 1)) {
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

  // `kamishibai capture` captures frames into a dir WITHOUT encoding — pair it
  // with `kamishibai encode` to split a render into its two halves.
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
    verbose: values.verbose,
    onLog: (msg) => process.stderr.write(`${msg}\n`),
  });
}

main().catch((err) => {
  process.stderr.write(`\nkamishibai: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
