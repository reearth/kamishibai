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
  verbose?: boolean;
}

/** Encode the f000000.png … sequence into a silent H.264 mp4. */
export async function encodeFrames(opts: EncodeOptions): Promise<void> {
  const { framesDir, fps, out, crf = 18, verbose = false } = opts;
  await runFfmpeg(
    [
      "-y",
      "-framerate", String(fps),
      "-i", join(framesDir, "f%06d.png"),
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-crf", String(crf),
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
 * Build the ffmpeg input args + filter_complex for an audio manifest.
 * Pure (no I/O) so it can be unit-tested. Each clip is, in order:
 * trimmed, timestamp-reset, faded, gain-adjusted, delayed to its start;
 * then all clips are mixed into [aout].
 */
export function buildAudioGraph(clips: AudioManifest): {
  inputs: string[];
  filterComplex: string;
} {
  const inputs: string[] = [];
  const filters: string[] = [];
  const labels: string[] = [];

  clips.forEach((clip, i) => {
    inputs.push("-i", clip.src);
    const inIndex = i + 1; // input 0 is the video
    const label = `a${i}`;
    const chain: string[] = [];

    // 1. trim the source (head/tail), then reset timestamps to 0
    if (clip.trimStartMs != null || clip.durationMs != null) {
      const parts: string[] = [];
      if (clip.trimStartMs != null) parts.push(`start=${ms2s(clip.trimStartMs)}`);
      if (clip.durationMs != null) parts.push(`duration=${ms2s(clip.durationMs)}`);
      chain.push(`atrim=${parts.join(":")}`, "asetpts=PTS-STARTPTS");
    }
    // 2. fades (relative to the clip's own start; fade-out needs durationMs)
    if (clip.fadeInMs) chain.push(`afade=t=in:st=0:d=${ms2s(clip.fadeInMs)}`);
    if (clip.fadeOutMs && clip.durationMs != null) {
      const st = Math.max(0, clip.durationMs - clip.fadeOutMs);
      chain.push(`afade=t=out:st=${ms2s(st)}:d=${ms2s(clip.fadeOutMs)}`);
    }
    // 3. static gain
    if (clip.gain) chain.push(`volume=${clip.gain}dB`);
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

  const { inputs, filterComplex } = buildAudioGraph(clips);

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
