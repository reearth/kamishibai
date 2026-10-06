// The orchestrator: serve -> probe -> split -> capture -> assemble.
// ------------------------------------------------------------------
import { mkdtemp, mkdir, rm, readdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import os from "node:os";
import { serveEntry } from "./serve.ts";
import { probeMeta, type ReelWaitOptions } from "./renderer.ts";
import { renderPool } from "./pool.ts";
import { splitFrames } from "./segment.ts";
import { frameCount, type KamishibaiMeta } from "./protocol.ts";
import { assertFfmpeg, hasAudioStream, probeDurationMs } from "./ffmpeg.ts";
import { applyDucking, type AudioManifest, type AudioClip } from "./audio.ts";
import type { Cue } from "./subtitle.ts";
import { assemble, writeMuxSidecar, readMuxSidecar } from "./assemble.ts";
import { createTTSEngine, type TTSAdapter, type TTSEngine } from "./tts/engine.ts";
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
  /** extra raw ffmpeg args for the video (H.264) encode pass — appended before
   *  the output so they add to or override the fixed settings (mp4 only) */
  encodeArgs?: string[];
  /** extra raw ffmpeg args for the audio/subtitle mux pass — appended before
   *  the output (mp4 only; no effect when the reel has no audio or subtitles) */
  muxArgs?: string[];
  /** stream ffmpeg output to the console */
  verbose?: boolean;
  /** keep the intermediate PNG frames instead of deleting them */
  keepFrames?: boolean;
  /**
   * Where to write the intermediate PNG frames. When set, the directory
   * is created if needed, stale frame files are cleared (with incremental /
   * only, just those past the reel's end), and the frames are kept after
   * rendering. When omitted, a temp dir is used and (unless
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
   * `framesDir` with a prior full render, at the same geometry, to fill the
   * gaps; the audio + subtitles muxed are that render's (from its sidecar),
   * since a partial seek only sees part of the markers.
   */
  only?: string;
  /**
   * Burn <Subtitle> captions into the frames (pixels, full CSS styling) instead
   * of the default soft mp4 track + sidecar .srt. Needed for GIF output, which
   * has no subtitle track.
   */
  burnSubtitles?: boolean;
  /** emit a "captured/encoded X/total" heartbeat at most this often (ms;
   *  default 60s). Short jobs finish before the first tick, so stay quiet. */
  progressEveryMs?: number;
  /** progress / status callback */
  onLog?: (msg: string) => void;
  /** custom TTS adapters for <Narration>/prepareNarration (a matching
   *  `provider` overrides a built-in: say / openai / elevenlabs / google /
   *  gemini / polly) */
  ttsAdapters?: TTSAdapter[];
  /** where baked narration audio is cached (default: <cwd>/.kamishibai-tts) */
  ttsCacheDir?: string;
  /** how long to wait for the page to expose window.kamishibai with nothing
   *  in progress (ms; default 15s). Narration synthesis in flight doesn't
   *  count against it. */
  probeTimeoutMs?: number;
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

/** Resolve an audio clip's src to something ffmpeg can read: an http(s) URL
 *  as-is, an existing file as an absolute path (so the mux sidecar still works
 *  when `encode` runs from another cwd), otherwise a served path resolved
 *  against publicDir (so <Video src="/clip.mp4"> finds publicDir/clip.mp4). */
function resolveAudioSrc(src: string, publicDir?: string): string {
  if (/^https?:\/\//i.test(src)) return src;
  if (existsSync(src)) return resolve(src);
  if (publicDir) {
    const candidate = join(resolve(publicDir), src.replace(/^\/+/, ""));
    if (existsSync(candidate)) return candidate;
  }
  return src;
}

/** Resolve clip srcs, drop any whose source has no audio stream (e.g. a silent
 *  video auto-registered by <Video>) so the mux can't fail on them, then
 *  auto-duck — after the drop, so a dropped narration line doesn't leave a
 *  phantom dip in the music. When something ducks, each source's length is
 *  probed so a clip without `durationMs` still dips the ducked ones. */
async function prepareAudio(
  clips: AudioManifest,
  publicDir: string | undefined,
  reelMs: number,
  log: (msg: string) => void,
): Promise<AudioManifest> {
  const resolved = clips.map((c) => ({ ...c, src: resolveAudioSrc(c.src, publicDir) }));
  const kept: AudioClip[] = [];
  for (const clip of resolved) {
    if (await hasAudioStream(clip.src)) kept.push(clip);
    else log(`  (skipping ${clip.src} — no audio stream)`);
  }
  const sourceMs = new Map<string, number>();
  if (kept.some((c) => c.duck)) {
    for (const c of kept) {
      if (c.duck || sourceMs.has(c.src)) continue;
      const ms = await probeDurationMs(c.src);
      if (ms != null) sourceMs.set(c.src, ms);
      else if (c.durationMs == null && !c.loop) {
        log(`  (can't probe the length of ${c.src} — it won't duck other clips; set durationMs)`);
      }
    }
  }
  return applyDucking(kept, { reelMs, sourceMs });
}

/** Remove existing f000000.png-style files with an index >= `from` (all of
 *  them by default), so a previous, longer run can't leak trailing frames into
 *  this one. Returns how many were removed. */
async function clearFrames(dir: string, from = 0): Promise<number> {
  const entries = await readdir(dir).catch(() => [] as string[]);
  const stale = entries.filter((f) => {
    const m = /^f(\d{6})\.png$/.exec(f);
    return !!m && Number(m[1]) >= from;
  });
  await Promise.all(stale.map((f) => unlink(join(dir, f))));
  return stale.length;
}

/** Count a frames dir's f000000.png … sequence, throwing if it has a gap:
 *  ffmpeg's image2 reader stops at the first missing index, so a gap would
 *  silently cut the video short of the count. */
async function countFrameSequence(dir: string): Promise<number> {
  const entries = await readdir(dir).catch(() => [] as string[]);
  const indices = entries
    .map((f) => /^f(\d{6})\.png$/.exec(f))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
  const gap = indices.findIndex((n, k) => n !== k);
  if (gap !== -1) {
    const name = (i: number) => `f${String(i).padStart(6, "0")}.png`;
    throw new Error(
      `${name(gap)} is missing from ${dir} (found ${indices.length} frame(s) up to ` +
        `${name(indices.at(-1)!)}) — capture the missing frames (e.g. --only ${gap}) before encoding`,
    );
  }
  return indices.length;
}

export interface CaptureOptions {
  /** a URL, an .html file, or a script entry (.ts/.tsx/.js/.jsx) */
  entry: string;
  /** dir to write the f000000.png … sequence into (created if needed) */
  framesDir: string;
  /** override the page's meta.fps (re-samples the same reel at this rate) */
  fps?: number;
  /** number of parallel Chrome instances; defaults to ~cpus-2 (max 8) */
  workers?: number;
  /** device scale factor — output pixels = meta size × scale (default 1) */
  scale?: number;
  /** static assets to serve at the server root (for staticFile-style paths) */
  publicDir?: string;
  /** extra audio clips, merged with the markers the page declares */
  audio?: AudioManifest;
  /** reuse cached frames by fingerprint; only re-capture changed frames */
  incremental?: boolean;
  /** render only these frame indices (e.g. "0-30,90"); leave the rest on disk.
   *  The result's audio/subtitles are then the prior full capture's sidecar. */
  only?: string;
  /** burn <Subtitle> captions into the frames instead of a soft track */
  burnSubtitles?: boolean;
  /** write the manifest + mux sidecar to the frames dir for later reuse
   *  (`encode`/incremental). Default true; render sets it false for a temp dir. */
  persist?: boolean;
  /** emit a "captured X/total" heartbeat at most this often (ms; default 60s) */
  progressEveryMs?: number;
  /** progress / status callback */
  onLog?: (msg: string) => void;
  /** custom TTS adapters for <Narration>/prepareNarration */
  ttsAdapters?: TTSAdapter[];
  /** where baked narration audio is cached (default: <cwd>/.kamishibai-tts) */
  ttsCacheDir?: string;
  /** how long to wait for the page to expose window.kamishibai with nothing
   *  in progress (ms; default 15s). Narration synthesis in flight doesn't
   *  count against it. */
  probeTimeoutMs?: number;
}

export interface CaptureResult {
  framesDir: string;
  meta: KamishibaiMeta;
  /** number of frames captured (the reel length) */
  frames: number;
  workers: number;
  /** final audio clips (resolved + ducked), ready to mux (with `only`: the
   *  prior full capture's, from its sidecar, when there is one) */
  audio: AudioManifest;
  /** soft subtitle cues collected from the page (with `only`: as for audio) */
  subtitles: Cue[];
}

/** How often to report narration progress while lines are synthesizing. */
const TTS_PROGRESS_EVERY_MS = 5_000;

/**
 * The narration pre-pass's TTS engine plus its logging: announces the first
 * synthesis, ticks "…narration done/total" while lines are in flight, and
 * builds the wait options so a slow first synthesis extends (rather than
 * trips) the page-load timeout.
 */
function narrationEngine(
  opts: { ttsAdapters?: TTSAdapter[]; ttsCacheDir?: string; probeTimeoutMs?: number },
  log: (msg: string) => void,
): { tts: TTSEngine; wait: ReelWaitOptions; summarize: () => void; stop: () => void } {
  let ticker: ReturnType<typeof setInterval> | undefined;
  const tts: TTSEngine = createTTSEngine({
    adapters: opts.ttsAdapters,
    cacheDir: opts.ttsCacheDir,
    onProgress: () => {
      if (ticker) return;
      log(`Synthesizing narration (uncached lines only)…`);
      ticker = setInterval(() => {
        const s = tts.stats();
        if (s.done + s.failed < s.total) {
          log(`  …narration ${s.done}/${s.total} line(s)${s.failed ? ` (${s.failed} failed)` : ""}`);
        }
      }, TTS_PROGRESS_EVERY_MS);
      ticker.unref?.();
    },
  });
  const wait: ReelWaitOptions = {
    timeoutMs: opts.probeTimeoutMs,
    busy: () => tts.busy(),
    describe: () => {
      const s = tts.stats();
      if (s.total === 0) return undefined;
      return (
        `narration synthesis finished ${s.done}/${s.total} new line(s)` +
        (s.lastError ? `; last error: ${s.lastError}` : "") +
        `. Finished lines are cached in ${tts.cacheDir}, so re-running resumes from there ` +
        `(or raise the limit with --probe-timeout)`
      );
    },
  };
  return {
    tts,
    wait,
    summarize: () => {
      const s = tts.stats();
      if (s.total > 0) {
        log(`  ✓ narration: ${s.done} line(s) synthesized${s.failed ? `, ${s.failed} failed` : ""}`);
      }
    },
    stop: () => clearInterval(ticker),
  };
}

/**
 * Capture an entry's frames into `framesDir` — serve, probe, split, and run the
 * parallel Chrome pool — WITHOUT encoding. Returns the geometry and the mux
 * inputs (resolved audio + subtitle cues); with `persist` (default), also writes
 * the manifest and mux sidecar so a later `encode` can rebuild the full video.
 */
export async function capture(opts: CaptureOptions): Promise<CaptureResult> {
  const log = opts.onLog ?? (() => {});
  const persist = opts.persist ?? true;
  const framesDir = resolve(opts.framesDir);
  if (opts.workers !== undefined && !(Number.isInteger(opts.workers) && opts.workers >= 1)) {
    throw new Error(`workers must be a positive integer, got ${opts.workers}`);
  }
  await assertFfmpeg();

  // The narration pre-pass: one engine for the whole capture (probe + every
  // worker share this server), so its cache + in-flight dedup make TTS run
  // once and freeze — deterministic across parallel capture.
  const narration = narrationEngine(opts, log);
  const { tts } = narration;
  const served = await serveEntry(opts.entry, {
    publicDir: opts.publicDir,
    tts: (body) => tts.handle(body as Parameters<typeof tts.handle>[0]),
    burnSubtitles: opts.burnSubtitles,
  });

  // Reuse (incremental/--only) keeps PNGs on disk, so don't wipe first.
  const reuse = !!(opts.incremental || opts.only);
  await mkdir(framesDir, { recursive: true });
  if (!reuse) await clearFrames(framesDir);

  try {
    log(`Probing ${served.url} …`);
    let probed;
    try {
      probed = await probeMeta(served.url, narration.wait);
    } finally {
      narration.stop();
    }
    narration.summarize();
    // An explicit --fps re-samples the same reel (ms-driven) at a new rate.
    const meta = opts.fps ? { ...probed, fps: opts.fps } : probed;
    const total = frameCount(meta);
    if (total < 1) {
      throw new Error(
        `the reel has no frames: durationMs ${meta.durationMs} at ${meta.fps}fps is shorter than one frame`,
      );
    }
    const workers = Math.min(opts.workers ?? defaultWorkers(), total);
    const chunks = splitFrames(total, workers);

    const scale = opts.scale ?? 1;
    const outW = meta.width * scale;
    const outH = meta.height * scale;

    // Reuse: load the previous run's fingerprints, but only if they describe
    // the same geometry (fps / size / scale) — otherwise the old prints don't
    // match these pixels. Incremental then rebuilds from scratch; --only can't
    // (it keeps the unselected PNGs as they are), so it refuses instead of
    // mixing two geometries in one sequence.
    const manifestKey: ManifestKey = {
      fps: meta.fps,
      width: meta.width,
      height: meta.height,
      scale,
      burnSubtitles: !!opts.burnSubtitles,
    };
    const prev = reuse ? await readManifest(framesDir) : undefined;
    if (prev && !manifestMatches(prev, manifestKey)) {
      if (opts.only) {
        throw new Error(
          `--only: ${framesDir} was captured with a different fps / size / scale / burn-subtitles ` +
            `(${prev.fps}fps ${prev.width}×${prev.height} @${prev.scale}x) than this run ` +
            `(${meta.fps}fps ${meta.width}×${meta.height} @${scale}x) — re-capture it without --only first`,
        );
      }
      log(`Cache geometry changed — rebuilding all frames.`);
    }
    if (opts.only && !prev) {
      log(`(--only: no cache manifest in ${framesDir}, so the other frames' geometry can't be checked)`);
    }
    // Prints past the reel's end describe frames this run deletes (below).
    const prevPrints = new Map([...manifestFrames(prev, manifestKey)].filter(([i]) => i < total));
    const prevFingerprints = opts.incremental ? prevPrints : undefined;

    // --only: restrict capture to the named frames; the rest stay on disk.
    const selected = opts.only ? parseFrameRanges(opts.only, total) : undefined;
    const shouldRender = selected ? (i: number) => selected.has(i) : undefined;

    // Reuse keeps the PNGs, so drop any past this reel's end (a previous,
    // longer run's tail) — encode would otherwise play them.
    if (reuse) {
      const removed = await clearFrames(framesDir, total);
      if (removed > 0) log(`(removed ${removed} stale frame(s) past the reel's end)`);
    }

    // Before any PNG is overwritten, rewrite the manifest to hold only prints
    // for frames this run won't touch (--only: the unselected ones; otherwise
    // none, since any frame may be re-captured). A run that dies mid-capture
    // then can't leave a print pointing at a PNG it already replaced.
    const untouched = selected
      ? new Map([...prevPrints].filter(([i]) => !selected.has(i)))
      : new Map<number, string>();
    if (persist) await writeManifest(framesDir, buildManifest(manifestKey, untouched));

    // New fingerprints accumulate here (across all workers) for the manifest.
    const fingerprints = new Map<number, string>();

    log(
      `Capturing ${selected ? `${selected.size} of ${total}` : `${total}`} frames (${outW}×${outH}` +
        `${scale !== 1 ? ` @${scale}x` : ""} @ ${meta.fps}fps) ` +
        `on ${chunks.length} Chrome instance(s)…` +
        `${opts.incremental && prevFingerprints?.size ? ` (incremental: ${prevFingerprints.size} cached)` : ""}`,
    );

    // Heartbeat: capture only reports per chunk (one Chrome finishing its whole
    // range), so a long reel can sit quiet for minutes. Emit a periodic
    // "captured X/total" so progress is visible without per-frame spam.
    let doneFrames = 0;
    const heartbeat = setInterval(() => {
      if (doneFrames > 0 && doneFrames < total) log(`  …captured ${doneFrames}/${total} frame(s)`);
    }, opts.progressEveryMs ?? 60_000);
    heartbeat.unref?.();

    let collected;
    try {
      collected = await renderPool({
        url: served.url,
        meta,
        chunks,
        framesDir,
        scale,
        prevFingerprints,
        shouldRender,
        wait: narration.wait,
        onProgress: (done) => {
          doneFrames = done;
        },
        onFingerprint: (i, fp) => fingerprints.set(i, fp),
        onChunkDone: (c) => log(`  ✓ chunk ${c.id}: frames ${c.start}..${c.end - 1}`),
      });
    } finally {
      clearInterval(heartbeat);
    }
    // Persist the manifest so the next run can build incrementally — always,
    // even with no prints (a page that returns none), since `encode` reads the
    // fps from it. Frames skipped by --only (no new print this run) keep their
    // old entry.
    if (persist) {
      await writeManifest(framesDir, buildManifest(manifestKey, new Map([...untouched, ...fingerprints])));
    }

    // Persist the mux inputs next to the frames so `encode` can rebuild the
    // full video later (audio + subtitles) without re-capturing — but only on a
    // full or incremental capture, which seeks every frame and so collects every
    // marker. A --only run seeks just the selected frames, so its markers are
    // partial; it keeps the prior full render's sidecar and returns that
    // sidecar's audio + subtitles instead (exactly what `encode` would mux).
    if (opts.only) {
      const sidecar = await readMuxSidecar(framesDir);
      if (sidecar) {
        log(`(--only: audio/subtitles come from the prior full capture's mux sidecar)`);
        return {
          framesDir,
          meta,
          frames: total,
          workers: chunks.length,
          audio: sidecar.audio,
          subtitles: sidecar.subtitles,
        };
      }
      log(
        `(--only: no mux sidecar from a prior full capture in ${framesDir} — ` +
          `audio/subtitles are only those seen on the selected frames)`,
      );
    }

    // Programmatic clips are *merged* with the markers the page declared (not a
    // replacement) — so passing `audio` adds to a page's <Audio>/<Narration>
    // instead of silently dropping it, and still works for a URL entry you
    // don't control (where there are no page markers).
    const declared = [...collected.audio, ...(opts.audio ?? [])];
    // Resolve srcs, drop silent clips, then auto-duck against the reel length
    // the mux clamps to.
    const audioClips = await prepareAudio(declared, opts.publicDir, (total / meta.fps) * 1000, log);

    if (persist && !opts.only) {
      await writeMuxSidecar(framesDir, audioClips, collected.subtitles);
    }

    return {
      framesDir,
      meta,
      frames: total,
      workers: chunks.length,
      audio: audioClips,
      subtitles: collected.subtitles,
    };
  } finally {
    await served.close();
  }
}

/**
 * Render an entry into an mp4/gif: capture the frames, then assemble (encode +
 * mux). Just composes `capture` and the assemble stage — no extra modes — so
 * `kamishibai capture` + `kamishibai encode` reproduce exactly what it does.
 */
export async function render(opts: RenderOptions): Promise<RenderResult> {
  const log = opts.onLog ?? (() => {});
  const started = Date.now();

  // Incremental / --only reuse PNGs across runs, so they need a persisted dir.
  const reuse = !!(opts.incremental || opts.only);
  if (reuse && !opts.framesDir) {
    throw new Error(
      `${opts.incremental ? "incremental" : "only"} needs a persisted frames dir — pass framesDir (--frames-dir)`,
    );
  }

  // Explicit framesDir -> keep it. Otherwise a temp dir, removed afterwards
  // (unless keepFrames). The temp case skips persisting manifest/sidecar.
  const usingTempFrames = !opts.framesDir;
  const framesDir = opts.framesDir
    ? resolve(opts.framesDir)
    : await mkdtemp(join(tmpdir(), "kamishibai-frames-"));

  const out = resolve(opts.out);
  await mkdir(dirname(out), { recursive: true });

  try {
    const cap = await capture({
      entry: opts.entry,
      framesDir,
      fps: opts.fps,
      workers: opts.workers,
      scale: opts.scale,
      publicDir: opts.publicDir,
      audio: opts.audio,
      incremental: opts.incremental,
      only: opts.only,
      burnSubtitles: opts.burnSubtitles,
      persist: !usingTempFrames,
      progressEveryMs: opts.progressEveryMs,
      onLog: log,
      ttsAdapters: opts.ttsAdapters,
      ttsCacheDir: opts.ttsCacheDir,
      probeTimeoutMs: opts.probeTimeoutMs,
    });

    // Reuse fills only some frames and trusts the dir for the rest — make sure
    // the whole sequence is there before encoding it.
    if (reuse) {
      const onDisk = await countFrameSequence(framesDir);
      if (onDisk < cap.frames) {
        throw new Error(
          `${framesDir} holds ${onDisk} of the reel's ${cap.frames} frames — ` +
            `capture the rest (e.g. --only ${onDisk}-${cap.frames - 1}) before encoding`,
        );
      }
    }

    await assemble({
      framesDir,
      fps: cap.meta.fps,
      totalFrames: cap.frames,
      out,
      audio: cap.audio,
      subtitles: cap.subtitles,
      crf: opts.crf,
      preset: opts.preset,
      maxWidth: opts.maxWidth,
      gifLoop: opts.gifLoop,
      encodeArgs: opts.encodeArgs,
      muxArgs: opts.muxArgs,
      verbose: opts.verbose,
      progressEveryMs: opts.progressEveryMs,
      log,
    });

    const elapsedMs = Date.now() - started;
    log(`Done → ${out} (${(elapsedMs / 1000).toFixed(1)}s)`);
    return { out, meta: cap.meta, frames: cap.frames, workers: cap.workers, elapsedMs };
  } finally {
    // Keep frames when the user picked the directory, or asked to keep them.
    const keep = opts.keepFrames || !usingTempFrames;
    if (keep) log(`Frames kept in ${framesDir}`);
    else await rm(framesDir, { recursive: true, force: true });
  }
}

export interface EncodeFramesDirOptions {
  /** dir holding a prior render's f000000.png … sequence */
  framesDir: string;
  /** output mp4/gif path */
  out: string;
  /** fps for the output; defaults to the frames dir's manifest fps */
  fps?: number;
  crf?: number;
  preset?: string;
  maxWidth?: number;
  gifLoop?: number;
  encodeArgs?: string[];
  muxArgs?: string[];
  /** emit an "encoded X/total" heartbeat at most this often (ms; default 60s) */
  progressEveryMs?: number;
  verbose?: boolean;
  onLog?: (msg: string) => void;
}

export interface EncodeResult {
  out: string;
  frames: number;
  fps: number;
  elapsedMs: number;
}

/**
 * Re-encode a frames dir into a video WITHOUT re-capturing — no browser, no
 * probe, no TTS, just ffmpeg. fps comes from the dir's manifest (or `fps`), and
 * the audio + soft subtitles come from the mux sidecar a prior *full* render
 * left behind (so the output is the full video, not silent). The fast path when
 * the frames are already correct and you only changed encode/mux settings.
 */
export async function encode(opts: EncodeFramesDirOptions): Promise<EncodeResult> {
  const log = opts.onLog ?? (() => {});
  const started = Date.now();
  await assertFfmpeg();

  const framesDir = resolve(opts.framesDir);
  const out = resolve(opts.out);
  await mkdir(dirname(out), { recursive: true });

  // Count the PNGs already on disk; that's the reel length here.
  const totalFrames = await countFrameSequence(framesDir);
  if (totalFrames === 0) {
    throw new Error(`no frames (f000000.png …) found in ${framesDir} — render there first`);
  }

  // fps: an explicit override, else the geometry the manifest recorded.
  const manifest = await readManifest(framesDir);
  const fps = opts.fps ?? manifest?.fps;
  if (!fps) {
    throw new Error(
      `no fps for ${framesDir} — pass fps (--fps), or render once with --frames-dir to write its manifest`,
    );
  }

  // Audio + soft subtitles from the sidecar a full render left; absent ⇒ silent.
  const sidecar = await readMuxSidecar(framesDir, (reason) =>
    log(`(${reason} — encoding without audio/subtitles)`),
  );

  log(`Encoding ${totalFrames} frame(s) from ${framesDir} @ ${fps}fps…`);
  await assemble({
    framesDir,
    fps,
    totalFrames,
    out,
    audio: sidecar?.audio ?? [],
    subtitles: sidecar?.subtitles ?? [],
    crf: opts.crf,
    preset: opts.preset,
    maxWidth: opts.maxWidth,
    gifLoop: opts.gifLoop,
    encodeArgs: opts.encodeArgs,
    muxArgs: opts.muxArgs,
    progressEveryMs: opts.progressEveryMs,
    verbose: opts.verbose,
    log,
  });

  const elapsedMs = Date.now() - started;
  log(`Done → ${out} (${(elapsedMs / 1000).toFixed(1)}s)`);
  return { out, frames: totalFrames, fps, elapsedMs };
}

export interface SynthesizeOptions {
  /** a URL, an .html file, or a script entry (.ts/.tsx/.js/.jsx) */
  entry: string;
  /** static assets to serve at the server root (for staticFile-style paths) */
  publicDir?: string;
  /** custom TTS adapters for <Narration>/prepareNarration */
  ttsAdapters?: TTSAdapter[];
  /** where baked narration audio is cached (default: <cwd>/.kamishibai-tts) */
  ttsCacheDir?: string;
  /** idle timeout while waiting for the page (ms; default 15s) */
  probeTimeoutMs?: number;
  /** progress / status callback */
  onLog?: (msg: string) => void;
}

export interface SynthesizeResult {
  /** lines synthesized this run (cache misses) */
  synthesized: number;
  /** lines that failed */
  failed: number;
  cacheDir: string;
}

/**
 * Bake an entry's narration into the TTS cache WITHOUT capturing frames: load
 * the page once (which runs its prepareNarration pre-pass) and stop. Run it
 * before a render to pay for — and check — every line up front; the render
 * then reads them all from the cache.
 */
export async function synthesize(opts: SynthesizeOptions): Promise<SynthesizeResult> {
  const log = opts.onLog ?? (() => {});
  const narration = narrationEngine(opts, log);
  const { tts } = narration;
  const served = await serveEntry(opts.entry, {
    publicDir: opts.publicDir,
    tts: (body) => tts.handle(body as Parameters<typeof tts.handle>[0]),
  });
  try {
    log(`Loading ${served.url} …`);
    try {
      await probeMeta(served.url, narration.wait);
    } finally {
      narration.stop();
    }
    const s = tts.stats();
    if (s.total === 0) log(`Narration is up to date — nothing new to synthesize.`);
    else narration.summarize();
    return { synthesized: s.done, failed: s.failed, cacheDir: tts.cacheDir };
  } finally {
    await served.close();
  }
}
