// Assembling captured PNG frames into the final video.
// ------------------------------------------------------------------
// The stage after capture: encode the f000000.png … sequence and mux in the
// audio + soft subtitles. Shared by a full `render` (which has just captured
// the frames) and `encode` (which reuses a frames dir without re-capturing) —
// so both produce byte-identical output from the same frames + mux inputs.
//
// To let `encode` rebuild the *full* video (not a silent one), a full render
// persists the mux inputs next to the frames as a sidecar: the resolved, ducked
// audio clips and the soft subtitle cues. A `--only` render does NOT write it —
// it seeks just the selected frames, so its collected markers are incomplete;
// the prior full render's sidecar is kept instead.
// ------------------------------------------------------------------
import { readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { encodeFrames, encodeGif, muxAudio, muxSubtitles } from "./ffmpeg.ts";
import { cuesToSrt, type Cue } from "./subtitle.ts";
import type { AudioManifest } from "./audio.ts";

/** Where the mux inputs live inside a frames dir (sibling to the manifest). */
export const MUX_SIDECAR_FILE = ".kamishibai-mux.json";
const MUX_SIDECAR_VERSION = 1;

/** The audio + subtitle inputs a full render collected, persisted so `encode`
 *  can rebuild the full video from a frames dir without re-capturing. */
export interface MuxSidecar {
  version: number;
  /** final clips (srcs resolved, ducking already applied), ready to mux */
  audio: AudioManifest;
  /** soft subtitle cues (empty when burned-in or none) */
  subtitles: Cue[];
}

export async function writeMuxSidecar(
  framesDir: string,
  audio: AudioManifest,
  subtitles: Cue[],
): Promise<void> {
  const sidecar: MuxSidecar = { version: MUX_SIDECAR_VERSION, audio, subtitles };
  await writeFile(join(framesDir, MUX_SIDECAR_FILE), JSON.stringify(sidecar));
}

/** Read a frames dir's mux sidecar, or undefined if missing/unreadable. */
export async function readMuxSidecar(framesDir: string): Promise<MuxSidecar | undefined> {
  try {
    const m = JSON.parse(await readFile(join(framesDir, MUX_SIDECAR_FILE), "utf8")) as MuxSidecar;
    return m && typeof m === "object" && m.version === MUX_SIDECAR_VERSION ? m : undefined;
  } catch {
    return undefined;
  }
}

export interface AssembleOptions {
  /** dir holding the f000000.png … sequence */
  framesDir: string;
  /** frames per second of the output */
  fps: number;
  /** number of frames in the sequence (sets the audio clamp length) */
  totalFrames: number;
  /** output path; `.gif` by extension, else mp4 */
  out: string;
  /** audio clips to mux (final, ready to use) */
  audio: AudioManifest;
  /** soft subtitle cues to embed as a track + sidecar .srt */
  subtitles: Cue[];
  crf?: number;
  preset?: string;
  maxWidth?: number;
  gifLoop?: number;
  encodeArgs?: string[];
  muxArgs?: string[];
  verbose?: boolean;
  log?: (msg: string) => void;
}

/** Encode the frames and mux in audio + subtitles, writing `out`. */
export async function assemble(opts: AssembleOptions): Promise<void> {
  const log = opts.log ?? (() => {});
  const { framesDir, fps, totalFrames, out, audio, subtitles } = opts;

  const hasSoftSubs = subtitles.length > 0;
  const srtSidecar = out.replace(/\.[^.]+$/, ".srt");

  if (out.toLowerCase().endsWith(".gif")) {
    if (audio.length > 0) log(`(gif has no audio — ignoring ${audio.length} clip(s))`);
    if (opts.preset) log(`(gif encode ignores --preset/--preview — it applies to the mp4 H.264 pass only)`);
    if (opts.encodeArgs?.length || opts.muxArgs?.length) {
      log(`(gif ignores --encode-args/--mux-args — they apply to the mp4 encode/mux passes only)`);
    }
    if (hasSoftSubs) {
      log(
        `(gif has no subtitle track — writing ${srtSidecar} only; ` +
          `use burnSubtitles to render captions into the gif)`,
      );
    }
    // GIF frame delays are quantized to 1/100s, so only fps values that
    // divide 100 (25, 50, 20, 10, …) are exact; others drift in speed.
    const cs = Math.max(1, Math.round(100 / fps));
    const effFps = 100 / cs;
    if (Math.abs(effFps - fps) > 0.01) {
      log(
        `(gif timing is quantized to 1/100s — ${fps}fps plays as ~${effFps.toFixed(2)}fps; ` +
          `use --fps with a divisor of 100 like 25 or 50)`,
      );
    }
    log(`Encoding GIF…`);
    await encodeGif({
      framesDir,
      fps,
      out,
      maxWidth: opts.maxWidth,
      loop: opts.gifLoop,
      verbose: opts.verbose,
    });
  } else {
    log(`Encoding video…`);
    const hasAudio = audio.length > 0;
    // Encode into a temp first when there's a mux pass to follow, so the last
    // pass writes `out`: encode -> (audio + subtitles, one pass).
    const encoded = hasAudio || hasSoftSubs ? join(framesDir, "_encoded.mp4") : out;
    await encodeFrames({
      framesDir,
      fps,
      out: encoded,
      crf: opts.crf,
      preset: opts.preset,
      maxWidth: opts.maxWidth,
      extraArgs: opts.encodeArgs,
      verbose: opts.verbose,
    });

    // Write the soft-subtitle srt once; it's embedded in whichever mux pass
    // runs (folded into the audio pass when there's audio, so the encoded
    // video is only ever read/written once for muxing).
    let srtTmp: string | undefined;
    if (hasSoftSubs) {
      srtTmp = join(framesDir, "_subs.srt");
      await writeFile(srtTmp, cuesToSrt(subtitles), "utf8");
    }

    if (hasAudio) {
      log(
        `Muxing ${audio.length} audio clip(s)` +
          `${hasSoftSubs ? ` + ${subtitles.length} subtitle cue(s)` : ""}…`,
      );
      await muxAudio({
        video: encoded,
        clips: audio,
        out,
        srt: srtTmp,
        videoDurationSec: totalFrames / fps,
        extraArgs: opts.muxArgs,
        verbose: opts.verbose,
      });
      await rm(encoded, { force: true }); // don't leave intermediates in a kept dir
    } else if (hasSoftSubs) {
      log(`Muxing ${subtitles.length} subtitle cue(s)…`);
      await muxSubtitles({ video: encoded, srt: srtTmp!, out, extraArgs: opts.muxArgs, verbose: opts.verbose });
      await rm(encoded, { force: true });
    }
    if (srtTmp) await rm(srtTmp, { force: true });
  }

  // Always emit the sidecar .srt alongside the output when there are soft cues
  // (handy for editing / portability, and the only delivery for gif).
  if (hasSoftSubs) {
    await writeFile(srtSidecar, cuesToSrt(subtitles), "utf8");
    log(`Subtitles → ${srtSidecar}`);
  }
}
