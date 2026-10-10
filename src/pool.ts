// Running chunks across several pages of one Chrome at once.
// ------------------------------------------------------------------
// The whole point: independent chunks => embarrassingly parallel. One
// Chrome runs a page per chunk and they race; completion order is
// irrelevant because each writes its own frame files by index.
// ------------------------------------------------------------------
import { captureChunk, launchChrome, type ChunkMarkers, type ReelWaitOptions } from "./renderer.ts";
import type { Chunk } from "./segment.ts";
import type { KamishibaiMeta } from "./protocol.ts";
import { clipKey, type AudioClip } from "./audio.ts";
import { mergeCues, type Cue } from "./subtitle.ts";

/** The merged markers a full render collected: audio clips + subtitle cues. */
export interface PoolMarkers {
  audio: AudioClip[];
  subtitles: Cue[];
}

export interface RenderPoolOptions {
  url: string;
  meta: KamishibaiMeta;
  chunks: Chunk[];
  framesDir: string;
  /** device scale factor passed to each worker (default 1) */
  scale?: number;
  /** called whenever any worker finishes a frame */
  onProgress?: (done: number, total: number) => void;
  /** called when a worker finishes its whole chunk */
  onChunkDone?: (chunk: Chunk) => void;
  /** called with each frame's fingerprint (for the cross-run manifest) */
  onFingerprint?: (index: number, fp: string) => void;
  /** previous run's fingerprints, shared read-only across workers */
  prevFingerprints?: Map<number, string>;
  /** --only predicate: render just these frame indices, leave the rest */
  shouldRender?: (index: number) => boolean;
  /** how long each worker waits for the page to expose window.kamishibai */
  wait?: ReelWaitOptions;
  /** capture with WebGL on the GPU (a reel that uses WebGL) */
  gpu?: boolean;
}

/**
 * Capture all chunks concurrently; resolves once every frame is on disk.
 * Returns the merged, de-duplicated audio + subtitle markers collected across
 * workers.
 */
export async function renderPool(opts: RenderPoolOptions): Promise<PoolMarkers> {
  const { url, meta, chunks, framesDir, scale, onProgress, onChunkDone } = opts;
  const { onFingerprint, prevFingerprints, shouldRender } = opts;
  const total = chunks.reduce((n, c) => n + (c.end - c.start), 0);
  let done = 0;

  // One browser for every chunk, each in its own page (and so its own
  // renderer process). Launching a Chrome per chunk started each one's GPU
  // process and loaded the reel in all of them at once, which cost seconds
  // before the first frame.
  const browser = await launchChrome(opts.gpu);
  let perChunk: ChunkMarkers[];
  try {
    perChunk = await Promise.all(
      chunks.map((chunk) =>
        captureChunk({
          url,
          meta,
          chunk,
          framesDir,
          scale,
          onFingerprint,
          prevFingerprints,
          shouldRender,
          wait: opts.wait,
          browser,
          onFrame: () => {
            done += 1;
            onProgress?.(done, total);
          },
        }).then((markers) => {
          onChunkDone?.(chunk);
          return markers;
        }),
      ),
    );
  } finally {
    await browser.close();
  }

  // Merge + dedup (a scene spanning a chunk boundary reports in both).
  const seen = new Set<string>();
  const audio: AudioClip[] = [];
  for (const clip of perChunk.flatMap((m) => m.audio)) {
    const key = clipKey(clip);
    if (seen.has(key)) continue;
    seen.add(key);
    audio.push(clip);
  }
  audio.sort((a, b) => a.atMs - b.atMs);

  // mergeCues handles cue dedup + sort by start.
  const subtitles = mergeCues(perChunk.flatMap((m) => m.subtitles));

  return { audio, subtitles };
}
