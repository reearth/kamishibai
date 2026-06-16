// Splitting work into parallel-capturable units.
// ------------------------------------------------------------------
// A reel of N frames is cut into contiguous chunks of frame indices.
// Each chunk is captured independently by its own Chrome, then the
// stills are reassembled in index order. Because frame i depends only
// on its time, it doesn't matter which Chrome rendered which chunk.
// ------------------------------------------------------------------

/** A contiguous, half-open range of frame indices: [start, end). */
export interface Chunk {
  /** index for display / logging (0-based) */
  id: number;
  start: number;
  /** exclusive */
  end: number;
}

/**
 * Split `total` frames into at most `parts` contiguous chunks.
 * Frames are distributed as evenly as possible; trailing parts may be
 * empty and are dropped (e.g. 3 frames over 4 workers -> 3 chunks).
 */
export function splitFrames(total: number, parts: number): Chunk[] {
  if (total <= 0) return [];
  const n = Math.max(1, Math.min(parts, total));
  const base = Math.floor(total / n);
  const remainder = total % n;

  const chunks: Chunk[] = [];
  let start = 0;
  for (let i = 0; i < n; i++) {
    // Hand the first `remainder` chunks one extra frame so the split is
    // balanced to within a single frame.
    const size = base + (i < remainder ? 1 : 0);
    if (size === 0) continue;
    chunks.push({ id: chunks.length, start, end: start + size });
    start += size;
  }
  return chunks;
}

/** Expand a chunk into its concrete list of frame indices. */
export function chunkIndices(chunk: Chunk): number[] {
  return Array.from({ length: chunk.end - chunk.start }, (_, k) => chunk.start + k);
}
