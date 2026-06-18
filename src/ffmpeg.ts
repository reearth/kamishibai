// Assembling stills into video, then muxing declared audio.
// ------------------------------------------------------------------
// ffmpeg is an external dependency — we shell out to it and never bundle
// it. Two steps: PNG sequence -> silent mp4, then (optionally) mux an
// audio manifest by delaying each clip to its start time and mixing.
// ------------------------------------------------------------------
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import type { AudioManifest } from "./audio.ts";

const execFileAsync = promisify(execFile);

/** Throw a friendly error if ffmpeg isn't on PATH. */
export async function assertFfmpeg(): Promise<void> {
  try {
    await execFileAsync("ffmpeg", ["-version"]);
  } catch {
    throw new Error(
      "ffmpeg not found on PATH. Install it (e.g. `brew install ffmpeg`) — kamishibai does not bundle it.",
    );
  }
}

/** Whether a media file has at least one audio stream (best-effort via ffprobe). */
export async function hasAudioStream(src: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-select_streams", "a",
      "-show_entries", "stream=index",
      "-of", "csv=p=0",
      src,
    ]);
    return stdout.trim().length > 0;
  } catch {
    // ffprobe missing or errored — assume audio is present and let ffmpeg decide.
    return true;
  }
}

function runFfmpeg(args: string[], verbose: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, {
      stdio: verbose ? "inherit" : ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    proc.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}\n${stderr.slice(-2000)}`));
    });
  });
}

export interface EncodeOptions {
  framesDir: string;
  fps: number;
  out: string;
  /** H.264 quality, lower = better; default 18 */
  crf?: number;
  /** downscale to at most this width (keeps aspect); omit for native size */
  maxWidth?: number;
  verbose?: boolean;
}

/** Encode the f000000.png … sequence into a silent H.264 mp4. */
export async function encodeFrames(opts: EncodeOptions): Promise<void> {
  const { framesDir, fps, out, crf = 18, maxWidth, verbose = false } = opts;
  // yuv420p needs even dimensions: cap width to an even number, height -2.
  const vf = maxWidth
    ? ["-vf", `scale='min(${Math.floor(maxWidth / 2) * 2},iw)':-2:flags=lanczos`]
    : [];
  await runFfmpeg(
    [
      "-y",
      "-framerate", String(fps),
      "-i", join(framesDir, "f%06d.png"),
      ...vf,
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-crf", String(crf),
      out,
    ],
    verbose,
  );
}

export interface EncodeGifOptions {
  framesDir: string;
  fps: number;
  out: string;
  /** downscale to at most this width (keeps aspect); omit for native size */
  maxWidth?: number;
  /** loop count: 0 = infinite (default), -1 = play once, n = repeat n times */
  loop?: number;
  verbose?: boolean;
}

/** Encode the f000000.png … sequence into a palette-optimized GIF (two-pass). */
export async function encodeGif(opts: EncodeGifOptions): Promise<void> {
  const { framesDir, fps, out, maxWidth, loop = 0, verbose = false } = opts;
  const seq = join(framesDir, "f%06d.png");
  const palette = join(framesDir, "_palette.png");
  const scale = maxWidth ? `,scale='min(${maxWidth},iw)':-1:flags=lanczos` : "";

  // Pass 1: build an optimized palette from the frames.
  await runFfmpeg(
    ["-y", "-i", seq, "-vf", `fps=${fps}${scale},palettegen=stats_mode=diff`, palette],
    verbose,
  );
  // Pass 2: render the GIF using that palette. -loop sets the NETSCAPE loop
  // extension (0 = loop forever).
  await runFfmpeg(
    [
      "-y",
      "-framerate", String(fps),
      "-i", seq,
      "-i", palette,
      "-lavfi", `fps=${fps}${scale}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3`,
      "-loop", String(loop),
      out,
    ],
    verbose,
  );
}

export interface MuxOptions {
  /** silent video to add audio to */
  video: string;
  clips: AudioManifest;
  out: string;
  /**
   * Clamp the output to this many seconds (the reel length). When omitted,
   * the output runs as long as its longest stream.
   */
  videoDurationSec?: number;
  verbose?: boolean;
}

const ms2s = (ms: number) => (ms / 1000).toFixed(6);

/**
 * Build an ffmpeg `volume` expression (a linear-amplitude function of `t` in
 * seconds) that interpolates dB keyframes linearly and holds flat outside the
 * range. `baseGainDb` is added to every keyframe.
 */
export function volumeExpr(
  keyframes: Array<{ atMs: number; gain: number }>,
  baseGainDb = 0,
): string {
  const kf = [...keyframes].sort((a, b) => a.atMs - b.atMs);
  const t = (i: number) => (kf[i]!.atMs / 1000).toFixed(6);
  const db = (i: number) => kf[i]!.gain + baseGainDb;
  const n = kf.length - 1;

  let inner = `${db(n)}`; // t >= last keyframe
  for (let i = n - 1; i >= 0; i--) {
    const dt = kf[i + 1]!.atMs - kf[i]!.atMs;
    const seg =
      dt <= 0
        ? `${db(i + 1)}` // coincident keyframes -> step
        : `(${db(i)}+(${db(i + 1) - db(i)})*(t-${t(i)})/${(dt / 1000).toFixed(6)})`;
    inner = `if(lt(t,${t(i + 1)}),${seg},${inner})`;
  }
  // t < first keyframe -> hold the first level
  const dbExpr = n >= 1 ? `if(lt(t,${t(0)}),${db(0)},${inner})` : `${db(0)}`;
  return `pow(10,(${dbExpr})/20)`;
}

/**
 * Build the ffmpeg input args + filter_complex for an audio manifest.
 * Pure (no I/O) so it can be unit-tested. Each clip is, in order:
 * trimmed, timestamp-reset, faded, gain-adjusted, delayed to its start;
 * then all clips are mixed into [aout].
 *
 * `videoDurationMs` (the reel length) is only used to bound `loop` clips: a
 * looped clip with no explicit `durationMs` is tiled (via `-stream_loop`) and
 * trimmed to span from its `atMs` to the reel end, which also gives `fadeOutMs`
 * a known end. Omit it and a looped clip just runs until the master `-t` clamps.
 */
export function buildAudioGraph(
  clips: AudioManifest,
  videoDurationMs?: number,
): {
  inputs: string[];
  filterComplex: string;
} {
  const inputs: string[] = [];
  const filters: string[] = [];
  const labels: string[] = [];

  clips.forEach((clip, i) => {
    // Loop: repeat the input indefinitely; the trim/clamp below bounds it.
    if (clip.loop) inputs.push("-stream_loop", "-1");
    inputs.push("-i", clip.src);
    const inIndex = i + 1; // input 0 is the video
    const label = `a${i}`;
    const chain: string[] = [];

    // The clip's effective length: explicit durationMs, or — for a loop with a
    // known reel length — the span from its start to the reel end.
    const loopSpan =
      clip.loop && clip.durationMs == null && videoDurationMs != null
        ? Math.max(0, videoDurationMs - Math.max(0, clip.atMs))
        : undefined;
    const effDurationMs = clip.durationMs ?? loopSpan;

    // 1. trim the source (head/tail), then reset timestamps to 0
    if (clip.trimStartMs != null || effDurationMs != null) {
      const parts: string[] = [];
      if (clip.trimStartMs != null) parts.push(`start=${ms2s(clip.trimStartMs)}`);
      if (effDurationMs != null) parts.push(`duration=${ms2s(effDurationMs)}`);
      chain.push(`atrim=${parts.join(":")}`, "asetpts=PTS-STARTPTS");
    }
    // 2. fades (relative to the clip's own start; fade-out needs a known end)
    if (clip.fadeInMs) chain.push(`afade=t=in:st=0:d=${ms2s(clip.fadeInMs)}`);
    if (clip.fadeOutMs && effDurationMs != null) {
      const st = Math.max(0, effDurationMs - clip.fadeOutMs);
      chain.push(`afade=t=out:st=${ms2s(st)}:d=${ms2s(clip.fadeOutMs)}`);
    }
    // 3. gain — automated (dB keyframes) or static
    if (clip.gainKeyframes && clip.gainKeyframes.length > 0) {
      chain.push(`volume=volume='${volumeExpr(clip.gainKeyframes, clip.gain ?? 0)}':eval=frame`);
    } else if (clip.gain) {
      chain.push(`volume=${clip.gain}dB`);
    }
    // 4. place on the reel timeline
    chain.push(`adelay=${Math.max(0, Math.round(clip.atMs))}:all=1`);

    // The input pad [N:a] is a prefix on the first filter, NOT comma-joined.
    filters.push(`[${inIndex}:a]${chain.join(",")}[${label}]`);
    labels.push(`[${label}]`);
  });

  // normalize=0 keeps each clip's level instead of attenuating by 1/N.
  const mix =
    labels.length === 1
      ? `${labels[0]}anull[aout]`
      : `${labels.join("")}amix=inputs=${labels.length}:normalize=0:dropout_transition=0[aout]`;

  return { inputs, filterComplex: [...filters, mix].join(";") };
}

/**
 * Mux an audio manifest onto a video: each clip is trimmed, faded, gained,
 * delayed to its start time, then mixed together. Video stream is copied.
 */
export async function muxAudio(opts: MuxOptions): Promise<void> {
  const { video, clips, out, videoDurationSec, verbose = false } = opts;
  if (clips.length === 0) {
    throw new Error("muxAudio called with an empty manifest");
  }

  const { inputs, filterComplex } = buildAudioGraph(
    clips,
    videoDurationSec != null ? videoDurationSec * 1000 : undefined,
  );

  // Clamp output to the video length: the reel is the master timeline, and
  // audio is expected to sit inside it. (Not -shortest, which would instead
  // trim the video down to a shorter audio track.)
  const clamp = videoDurationSec ? ["-t", String(videoDurationSec)] : [];

  await runFfmpeg(
    [
      "-y",
      "-i", video,
      ...inputs,
      "-filter_complex", filterComplex,
      "-map", "0:v",
      "-map", "[aout]",
      "-c:v", "copy",
      "-c:a", "aac",
      ...clamp,
      out,
    ],
    verbose,
  );
}
