// Running chunks across several Chrome instances at once.
// ------------------------------------------------------------------
// The whole point: independent chunks => embarrassingly parallel. We
// launch one Chrome per chunk and let them race; completion order is
// irrelevant because each writes its own frame files by index.
// ------------------------------------------------------------------
import { captureChunk } from "./renderer.ts";
import type { Chunk } from "./segment.ts";
import type { KamishibaiMeta } from "./protocol.ts";
import type { AudioClip } from "./audio.ts";

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
}

/**
 * Capture all chunks concurrently; resolves once every frame is on disk.
 * Returns the merged, de-duplicated audio markers collected across workers.
 */
export async function renderPool(opts: RenderPoolOptions): Promise<AudioClip[]> {
  const { url, meta, chunks, framesDir, scale, onProgress, onChunkDone } = opts;
  const total = chunks.reduce((n, c) => n + (c.end - c.start), 0);
  let done = 0;

  const perChunk = await Promise.all(
    chunks.map((chunk) =>
      captureChunk({
        url,
        meta,
        chunk,
        framesDir,
        scale,
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

  // Merge + dedup (a scene spanning a chunk boundary reports in both).
  const seen = new Set<string>();
  const merged: AudioClip[] = [];
  for (const clip of perChunk.flat()) {
    const key = `${clip.src}@${clip.atMs}@${clip.gain ?? 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(clip);
  }
  merged.sort((a, b) => a.atMs - b.atMs);
  return merged;
}
