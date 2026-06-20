// The orchestrator: serve -> probe -> split -> capture -> assemble.
// ------------------------------------------------------------------
import { mkdtemp, mkdir, rm, readdir, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import os from "node:os";
import { serveEntry } from "./serve.ts";
import { probeMeta } from "./renderer.ts";
import { renderPool } from "./pool.ts";
import { splitFrames } from "./segment.ts";
import { frameCount, type KamishibaiMeta } from "./protocol.ts";
import {
  assertFfmpeg,
  encodeFrames,
  encodeGif,
  muxAudio,
  muxSubtitles,
  hasAudioStream,
} from "./ffmpeg.ts";
import { applyDucking, type AudioManifest, type AudioClip } from "./audio.ts";
import { cuesToSrt } from "./subtitle.ts";
import { createTTSEngine, type TTSAdapter } from "./tts/engine.ts";
import {
  buildManifest,
  manifestFrames,
  manifestMatches,
  parseFrameRanges,
  readManifest,
  writeManifest,
  type ManifestKey,
} from "./incremental.ts";

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
  /** extra audio clips to mux, merged with the markers the page declares
   *  (e.g. add audio to a URL entry you don't control) */
  audio?: AudioManifest;
  /** H.264 quality (lower = better); default 18 */
  crf?: number;
  /** libx264 speed/compression preset for the mp4 encode (e.g. "ultrafast" for
   *  a quick confirm pass); omit for x264's default. Pairs well with
   *  incremental/only — once capture is skipped, the full re-encode dominates.
   *  No effect on GIF output. */
  preset?: string;
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
  /**
   * Reuse cached frames: each frame's fingerprint is compared to the previous
   * run's (stored in the frames dir), and unchanged frames keep their PNG —
   * only changed frames are re-captured. Requires `framesDir`.
   */
  incremental?: boolean;
  /**
   * Render only these frame indices (e.g. "0-30,90,120-150"); every other PNG
   * is left untouched. A manual alternative to `incremental`. Requires
   * `framesDir` with a prior full render to fill the gaps.
   */
  only?: string;
  /**
   * Burn <Subtitle> captions into the frames (pixels, full CSS styling) instead
   * of the default soft mp4 track + sidecar .srt. Needed for GIF output, which
   * has no subtitle track.
   */
  burnSubtitles?: boolean;
  /** progress / status callback */
  onLog?: (msg: string) => void;
  /** custom TTS adapters for <Narration>/prepareNarration (a matching
   *  `provider` overrides a built-in: say / openai / elevenlabs) */
  ttsAdapters?: TTSAdapter[];
  /** where baked narration audio is cached (default: <cwd>/.kamishibai-tts) */
  ttsCacheDir?: string;
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

  // The narration pre-pass: one engine for the whole render (probe + every
  // worker share this server), so its cache + in-flight dedup make TTS run
  // once and freeze — deterministic across parallel capture.
  const tts = createTTSEngine({ adapters: opts.ttsAdapters, cacheDir: opts.ttsCacheDir });
  const served = await serveEntry(opts.entry, {
    publicDir: opts.publicDir,
    tts: (body) => tts.handle(body as Parameters<typeof tts.handle>[0]),
    burnSubtitles: opts.burnSubtitles,
  });

  // Incremental / --only reuse PNGs on disk across runs, so they need a
  // persisted frames dir and must NOT wipe it first.
  const reuse = !!(opts.incremental || opts.only);
  if (reuse && !opts.framesDir) {
    throw new Error(
      `${opts.incremental ? "incremental" : "only"} needs a persisted frames dir — pass framesDir (--frames-dir)`,
    );
  }

  // Explicit framesDir -> create it, clear stale frames, and keep it.
  // Otherwise use a temp dir that's removed afterwards (unless keepFrames).
  const usingTempFrames = !opts.framesDir;
  const framesDir = opts.framesDir
    ? resolve(opts.framesDir)
    : await mkdtemp(join(tmpdir(), "kamishibai-frames-"));
  await mkdir(framesDir, { recursive: true });
  // Clear stale frames for a fresh explicit-dir run, but keep them when we're
  // reusing (incremental/--only) so cached frames survive into this run.
  if (!usingTempFrames && !reuse) await clearFrames(framesDir);

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

    // Incremental: load the previous run's fingerprints, but only if they
    // describe the same geometry (fps / size / scale) — otherwise the old
    // prints don't match these pixels and we rebuild from scratch.
    const manifestKey: ManifestKey = {
      fps: meta.fps,
      width: meta.width,
      height: meta.height,
      scale,
      burnSubtitles: !!opts.burnSubtitles,
    };
    let prevFingerprints: Map<number, string> | undefined;
    if (opts.incremental) {
      const prev = await readManifest(framesDir);
      if (prev && !manifestMatches(prev, manifestKey)) {
        log(`Cache geometry changed — rebuilding all frames.`);
      }
      prevFingerprints = manifestFrames(prev, manifestKey);
    }

    // --only: restrict capture to the named frames; the rest stay on disk.
    const selected = opts.only ? parseFrameRanges(opts.only, total) : undefined;
    const shouldRender = selected ? (i: number) => selected.has(i) : undefined;

    // New fingerprints accumulate here (across all workers) for the manifest.
    const fingerprints = new Map<number, string>();

    log(
      `Capturing ${selected ? `${selected.size} of ${total}` : `${total}`} frames (${outW}×${outH}` +
        `${scale !== 1 ? ` @${scale}x` : ""} @ ${meta.fps}fps) ` +
        `on ${chunks.length} Chrome instance(s)…` +
        `${opts.incremental && prevFingerprints?.size ? ` (incremental: ${prevFingerprints.size} cached)` : ""}`,
    );

    const { audio: collectedAudio, subtitles: collectedSubtitles } = await renderPool({
      url: served.url,
      meta,
      chunks,
      framesDir,
      scale,
      prevFingerprints,
      shouldRender,
      onFingerprint: (i, fp) => fingerprints.set(i, fp),
      onChunkDone: (c) => log(`  ✓ chunk ${c.id}: frames ${c.start}..${c.end - 1}`),
    });

    // Persist the manifest whenever frames are kept, so the next run can build
    // incrementally. Merge over the previous prints so frames skipped by --only
    // (which produced no new print this run) keep their old entry.
    if (!usingTempFrames) {
      const prevForMerge = opts.only ? manifestFrames(await readManifest(framesDir), manifestKey) : undefined;
      const merged = prevForMerge ? new Map([...prevForMerge, ...fingerprints]) : fingerprints;
      if (merged.size > 0) await writeManifest(framesDir, buildManifest(manifestKey, merged));
    }

    // Programmatic clips are *merged* with the markers the page declared (not a
    // replacement) — so passing `audio` adds to a page's <Audio>/<Narration>
    // instead of silently dropping it, and still works for a URL entry you
    // don't control (where there are no page markers).
    const declared = [...collectedAudio, ...(opts.audio ?? [])];
    // Resolve srcs and drop silent clips first, then auto-duck (so a dropped
    // narration line doesn't leave a phantom dip in the music).
    const audioClips = applyDucking(await prepareAudio(declared, opts.publicDir, log));

    // Soft subtitle cues only exist when not burning in (burn renders pixels and
    // registers no markers). The sidecar .srt is written next to the output.
    const hasSoftSubs = collectedSubtitles.length > 0;
    const srtSidecar = out.replace(/\.[^.]+$/, ".srt");

    if (out.toLowerCase().endsWith(".gif")) {
      if (audioClips.length > 0) log(`(gif has no audio — ignoring ${audioClips.length} clip(s))`);
      if (opts.preset) log(`(gif encode ignores --preset/--preview — it applies to the mp4 H.264 pass only)`);
      if (hasSoftSubs) {
        log(
          `(gif has no subtitle track — writing ${srtSidecar} only; ` +
            `use burnSubtitles to render captions into the gif)`,
        );
      }
      // GIF frame delays are quantized to 1/100s, so only fps values that
      // divide 100 (25, 50, 20, 10, …) are exact; others drift in speed.
      const cs = Math.max(1, Math.round(100 / meta.fps));
      const effFps = 100 / cs;
      if (Math.abs(effFps - meta.fps) > 0.01) {
        log(
          `(gif timing is quantized to 1/100s — ${meta.fps}fps plays as ~${effFps.toFixed(2)}fps; ` +
            `use --fps with a divisor of 100 like 25 or 50)`,
        );
      }
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
      // Build the output in stages, each into a temp, so the last stage writes
      // `out`: encode -> (audio) -> (subtitles).
      const encoded = hasAudio || hasSoftSubs ? join(framesDir, "_encoded.mp4") : out;
      await encodeFrames({
        framesDir,
        fps: meta.fps,
        out: encoded,
        crf: opts.crf,
        preset: opts.preset,
        maxWidth: opts.maxWidth,
        verbose: opts.verbose,
      });

      let videoPath = encoded;
      if (hasAudio) {
        const next = hasSoftSubs ? join(framesDir, "_audio.mp4") : out;
        log(`Muxing ${audioClips.length} audio clip(s)…`);
        await muxAudio({
          video: videoPath,
          clips: audioClips,
          out: next,
          videoDurationSec: total / meta.fps,
          verbose: opts.verbose,
        });
        await rm(videoPath, { force: true }); // don't leave intermediates in a kept dir
        videoPath = next;
      }

      if (hasSoftSubs) {
        const srtTmp = join(framesDir, "_subs.srt");
        await writeFile(srtTmp, cuesToSrt(collectedSubtitles), "utf8");
        log(`Muxing ${collectedSubtitles.length} subtitle cue(s)…`);
        await muxSubtitles({ video: videoPath, srt: srtTmp, out, verbose: opts.verbose });
        await rm(videoPath, { force: true });
        await rm(srtTmp, { force: true });
      }
    }

    // Always emit the sidecar .srt alongside the output when there are soft cues
    // (handy for editing / portability, and the only delivery for gif).
    if (hasSoftSubs) {
      await writeFile(srtSidecar, cuesToSrt(collectedSubtitles), "utf8");
      log(`Subtitles → ${srtSidecar}`);
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
