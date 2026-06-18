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
import { render } from "./render.ts";
import SKILL from "./skill.md";

const HELP = `kamishibai — seek a web page frame by frame and bake it into an mp4.

Usage:
  kamishibai render <entry|url> [options]
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
      --max-width <n>   downscale the output (mp4 or gif) to at most n px wide
      --gif-loop <n>    gif loops: 0 = infinite (default), -1 = once, n = times
      --crf <n>         H.264 quality, lower = better (default: 18)
      --keep-frames     keep the intermediate PNG frames
      --verbose         stream ffmpeg output
  -h, --help            show this help

Examples:
  kamishibai render reel.tsx -o reel.mp4 -w 4
  kamishibai render reel.tsx -s 2 -o reel@2x.mp4
  kamishibai render http://localhost:3000 -o page.mp4
  kamishibai render reel.tsx -p public -o reel.mp4
  kamishibai skill > kamishibai.md
`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: "string", short: "o" },
      workers: { type: "string", short: "w" },
      fps: { type: "string" },
      scale: { type: "string", short: "s" },
      public: { type: "string", short: "p" },
      "frames-dir": { type: "string", short: "f" },
      "max-width": { type: "string" },
      "gif-loop": { type: "string" },
      crf: { type: "string" },
      "keep-frames": { type: "boolean" },
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

  if (command !== "render") {
    process.stderr.write(`Unknown command "${command}". Try: kamishibai render <entry|url>\n`);
    process.exit(1);
  }
  if (!entry) {
    process.stderr.write(`Missing <entry|url>.\n\n${HELP}`);
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
    crf,
    keepFrames: values["keep-frames"],
    verbose: values.verbose,
    onLog: (msg) => process.stderr.write(`${msg}\n`),
  });
}

main().catch((err) => {
  process.stderr.write(`\nkamishibai: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
