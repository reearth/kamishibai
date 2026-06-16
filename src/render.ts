// The orchestrator: serve -> probe -> split -> capture -> assemble.
// ------------------------------------------------------------------
import { mkdtemp, mkdir, rm, readdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import os from "node:os";
import { serveEntry } from "./serve.ts";
import { probeMeta } from "./renderer.ts";
import { renderPool } from "./pool.ts";
import { splitFrames } from "./segment.ts";
import { frameCount, type KamishibaiMeta } from "./protocol.ts";
import { assertFfmpeg, encodeFrames, encodeGif, muxAudio, hasAudioStream } from "./ffmpeg.ts";
import type { AudioManifest, AudioClip } from "./audio.ts";

export interface RenderOptions {
  /** a URL, an .html file, or a script entry (.ts/.tsx/.js/.jsx) */
  entry: string;
  /** output mp4 path */
  out: string;
  /** override the page's meta.fps (re-samples the same reel at this rate) */
  fps?: number;
  /** number of parallel Chrome instances; defaults to ~cpus-2 (max 8) */
  workers?: number;
  /** device scale factor — output pixels = meta size × scale (default 1) */
  scale?: number;
  /** downscale the output to at most this width (mp4 or gif; keeps aspect) */
  maxWidth?: number;
  /** gif loop count: 0 = infinite (default), -1 = play once, n = repeat n times */
  gifLoop?: number;
  /** static assets to serve at the server root (for staticFile-style paths) */
  publicDir?: string;
  /** audio clips to mux in */
  audio?: AudioManifest;
  /** H.264 quality (lower = better); default 18 */
  crf?: number;
  /** stream ffmpeg output to the console */
  verbose?: boolean;
  /** keep the intermediate PNG frames instead of deleting them */
  keepFrames?: boolean;
  /**
   * Where to write the intermediate PNG frames. When set, the directory
   * is created if needed, stale frame files are cleared, and the frames
   * are kept after rendering. When omitted, a temp dir is used and (unless
   * keepFrames is set) removed afterwards.
   */
  framesDir?: string;
  /** progress / status callback */
  onLog?: (msg: string) => void;
}

export interface RenderResult {
  out: string;
  meta: KamishibaiMeta;
  frames: number;
  workers: number;
  elapsedMs: number;
}

function defaultWorkers(): number {
  return Math.min(8, Math.max(1, os.cpus().length - 2));
}

/** Resolve an audio clip's src to something ffmpeg can read: an http(s) URL or
 *  existing file as-is, otherwise a served path resolved against publicDir
 *  (so <Video src="/clip.mp4"> finds publicDir/clip.mp4). */
function resolveAudioSrc(src: string, publicDir?: string): string {
  if (/^https?:\/\//i.test(src)) return src;
  if (existsSync(src)) return src;
  if (publicDir) {
    const candidate = join(resolve(publicDir), src.replace(/^\/+/, ""));
    if (existsSync(candidate)) return candidate;
  }
  return src;
}

/** Resolve clip srcs and drop any whose source has no audio stream (e.g. a
 *  silent video auto-registered by <Video>), so the mux can't fail on them. */
async function prepareAudio(
  clips: AudioManifest,
  publicDir: string | undefined,
  log: (msg: string) => void,
): Promise<AudioManifest> {
  const resolved = clips.map((c) => ({ ...c, src: resolveAudioSrc(c.src, publicDir) }));
  const kept: AudioClip[] = [];
  for (const clip of resolved) {
    if (await hasAudioStream(clip.src)) kept.push(clip);
    else log(`  (skipping ${clip.src} — no audio stream)`);
  }
  return kept;
}

/** Remove any existing f000000.png-style files so a previous, longer run
 *  can't leak trailing frames into this one. */
async function clearFrames(dir: string): Promise<void> {
  const entries = await readdir(dir).catch(() => [] as string[]);
  await Promise.all(
    entries
      .filter((f) => /^f\d{6}\.png$/.test(f))
      .map((f) => unlink(join(dir, f))),
  );
}

/** Render an entry into an mp4. Returns once the file is written. */
export async function render(opts: RenderOptions): Promise<RenderResult> {
  const log = opts.onLog ?? (() => {});
  const started = Date.now();

  await assertFfmpeg();

  const served = await serveEntry(opts.entry, { publicDir: opts.publicDir });

  // Explicit framesDir -> create it, clear stale frames, and keep it.
  // Otherwise use a temp dir that's removed afterwards (unless keepFrames).
  const usingTempFrames = !opts.framesDir;
  const framesDir = opts.framesDir
    ? resolve(opts.framesDir)
    : await mkdtemp(join(tmpdir(), "kamishibai-frames-"));
  await mkdir(framesDir, { recursive: true });
  if (!usingTempFrames) await clearFrames(framesDir);

  const out = resolve(opts.out);
  await mkdir(dirname(out), { recursive: true });

  try {
    log(`Probing ${served.url} …`);
    const probed = await probeMeta(served.url);
    // An explicit --fps re-samples the same reel (ms-driven) at a new rate.
    const meta = opts.fps ? { ...probed, fps: opts.fps } : probed;
    const total = frameCount(meta);
    const workers = Math.min(opts.workers ?? defaultWorkers(), total);
    const chunks = splitFrames(total, workers);

    const scale = opts.scale ?? 1;
    const outW = meta.width * scale;
    const outH = meta.height * scale;
    log(
      `Capturing ${total} frames (${outW}×${outH}` +
        `${scale !== 1 ? ` @${scale}x` : ""} @ ${meta.fps}fps) ` +
        `on ${chunks.length} Chrome instance(s)…`,
    );

    const collectedAudio = await renderPool({
      url: served.url,
      meta,
      chunks,
      framesDir,
      scale,
      onChunkDone: (c) => log(`  ✓ chunk ${c.id}: frames ${c.start}..${c.end - 1}`),
    });

    // An explicit manifest wins; otherwise use markers the page declared.
    const declared = opts.audio && opts.audio.length > 0 ? opts.audio : collectedAudio;
    const audioClips = await prepareAudio(declared, opts.publicDir, log);

    if (out.toLowerCase().endsWith(".gif")) {
      if (audioClips.length > 0) log(`(gif has no audio — ignoring ${audioClips.length} clip(s))`);
      log(`Encoding GIF…`);
      await encodeGif({
        framesDir,
        fps: meta.fps,
        out,
        maxWidth: opts.maxWidth,
        loop: opts.gifLoop,
        verbose: opts.verbose,
      });
    } else {
      log(`Encoding video…`);
      const hasAudio = audioClips.length > 0;
      const silent = hasAudio ? join(framesDir, "_silent.mp4") : out;
      await encodeFrames({
        framesDir,
        fps: meta.fps,
        out: silent,
        crf: opts.crf,
        maxWidth: opts.maxWidth,
        verbose: opts.verbose,
      });

      if (hasAudio) {
        log(`Muxing ${audioClips.length} audio clip(s)…`);
        await muxAudio({
          video: silent,
          clips: audioClips,
          out,
          videoDurationSec: total / meta.fps,
          verbose: opts.verbose,
        });
        // Don't leave the intermediate in a kept frames dir.
        await rm(silent, { force: true });
      }
    }

    const elapsedMs = Date.now() - started;
    log(`Done → ${out} (${(elapsedMs / 1000).toFixed(1)}s)`);
    return { out, meta, frames: total, workers: chunks.length, elapsedMs };
  } finally {
    await served.close();
    // Keep frames when the user picked the directory, or asked to keep them.
    const keep = opts.keepFrames || !usingTempFrames;
    if (keep) log(`Frames kept in ${framesDir}`);
    else await rm(framesDir, { recursive: true, force: true });
  }
}
