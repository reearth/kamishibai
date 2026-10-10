// Encoding an incremental render in segments.
// ------------------------------------------------------------------
// An incremental render re-captures only the frames an edit changed, but a
// plain encode still turns every frame into H.264 again. So when the frames
// have prints, the video is encoded in short segments, each kept in the
// frames dir under a key made of its frames' prints and everything else that
// decides its bytes (geometry, fps, encode settings). The next run encodes
// only the segments whose key is new and joins them all with ffmpeg's concat
// demuxer, which copies the streams: an edit to one scene re-encodes a few
// seconds of video, and an edit to the sound alone re-encodes none.
// ------------------------------------------------------------------
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { fnv1a64 } from "./fingerprint.ts";
import { concatVideos, encodeFrames } from "./ffmpeg.ts";

/** Where the segments live inside a frames dir. */
export const SEGMENTS_DIR = ".kamishibai-segments";
const SEGMENT_VERSION = 1;
/** Segment length. Shorter re-encodes less after an edit; each segment starts
 *  with a keyframe, so shorter also makes the file a little larger. */
export const SEGMENT_SECONDS = 2;

export interface Segment {
  /** first frame */
  start: number;
  /** one past the last frame */
  end: number;
  /** the segment's cache key; undefined when a frame in it has no print, so
   *  nothing says whether it changed and it is always encoded */
  key?: string;
  /** file name inside SEGMENTS_DIR */
  file: string;
}

/**
 * Split `total` frames into segments of SEGMENT_SECONDS and key each one by
 * its frames' prints and `settings` (everything else that decides its bytes).
 */
export function planSegments(
  total: number,
  fps: number,
  prints: ReadonlyMap<number, string>,
  settings: unknown,
): Segment[] {
  const size = Math.max(1, Math.round(SEGMENT_SECONDS * fps));
  const segments: Segment[] = [];
  for (let start = 0; start < total; start += size) {
    const end = Math.min(total, start + size);
    const frames: string[] = [];
    for (let i = start; i < end; i++) {
      const p = prints.get(i);
      if (p === undefined) break;
      frames.push(p);
    }
    const key =
      frames.length === end - start
        ? fnv1a64(JSON.stringify({ v: SEGMENT_VERSION, settings, start, frames }))
        : undefined;
    const name = `s${String(start).padStart(6, "0")}`;
    segments.push({ start, end, key, file: `${name}-${key ?? "unkeyed"}.mp4` });
  }
  return segments;
}

export interface EncodeSegmentedOptions {
  framesDir: string;
  fps: number;
  totalFrames: number;
  /** each frame's print (missing ones make their segment unkeyed) */
  prints: ReadonlyMap<number, string>;
  /** what else decides the frames' pixels, e.g. "1920x1080@1" */
  geometry: string;
  /** the silent mp4 to write */
  out: string;
  crf?: number;
  preset?: string;
  maxWidth?: number;
  encodeArgs?: string[];
  /** called after each segment with how many are done, and how many there are */
  onProgress?: (done: number, total: number) => void;
  verbose?: boolean;
}

/** Encode the frames into `out` in segments, reusing the ones a previous run
 *  left that are still valid. Returns how many segments were encoded. */
export async function encodeSegmented(opts: EncodeSegmentedOptions): Promise<{ encoded: number; total: number }> {
  const { framesDir, fps, totalFrames, prints, out } = opts;
  const dir = join(framesDir, SEGMENTS_DIR);
  await mkdir(dir, { recursive: true });
  const settings = {
    geometry: opts.geometry,
    fps,
    crf: opts.crf ?? 18,
    preset: opts.preset ?? null,
    maxWidth: opts.maxWidth ?? null,
    encodeArgs: opts.encodeArgs ?? [],
  };
  const segments = planSegments(totalFrames, fps, prints, settings);
  const todo = segments.filter((s) => !s.key || !existsSync(join(dir, s.file)));

  // A few encodes at once: libx264 already spreads one encode over several
  // threads, and the segments are short, so this mostly hides each process's
  // start-up and the frames' PNG decoding.
  let next = 0;
  let done = segments.length - todo.length;
  const worker = async () => {
    for (let s = todo[next++]; s; s = todo[next++]) {
      const file = join(dir, s.file);
      // Write under a temp name, so a killed run can't leave a half-written
      // segment under a valid key.
      const tmp = `${file}.part.mp4`;
      await encodeFrames({
        framesDir,
        fps,
        out: tmp,
        crf: opts.crf,
        preset: opts.preset,
        maxWidth: opts.maxWidth,
        extraArgs: opts.encodeArgs,
        range: { from: s.start, count: s.end - s.start },
        verbose: opts.verbose,
      });
      await rename(tmp, file);
      opts.onProgress?.(++done, segments.length);
    }
  };
  const parallel = Math.max(1, Math.min(4, Math.floor(os.cpus().length / 2), todo.length));
  await Promise.all(Array.from({ length: parallel }, worker));

  await concatVideos(segments.map((s) => join(dir, s.file)), out, opts.verbose);

  // Drop segments this reel no longer uses (an edit's old versions).
  const keep = new Set(segments.map((s) => s.file));
  for (const f of await readdir(dir)) {
    if (!keep.has(f)) await rm(join(dir, f), { force: true });
  }
  return { encoded: todo.length, total: segments.length };
}
