import { describe, it, expect } from "vitest";
import { splitFrames, chunkIndices } from "../src/segment.ts";
import { frameCount, frameTimeMs } from "../src/protocol.ts";

describe("splitFrames", () => {
  it("covers every frame exactly once, in order", () => {
    const chunks = splitFrames(180, 4);
    const all = chunks.flatMap(chunkIndices);
    expect(all).toEqual(Array.from({ length: 180 }, (_, i) => i));
  });

  it("balances chunk sizes to within one frame", () => {
    const chunks = splitFrames(10, 3);
    expect(chunks.map((c) => c.end - c.start)).toEqual([4, 3, 3]);
  });

  it("never produces more chunks than frames", () => {
    expect(splitFrames(3, 8)).toHaveLength(3);
  });

  it("returns no chunks for an empty reel", () => {
    expect(splitFrames(0, 4)).toEqual([]);
  });

  it("produces contiguous, non-overlapping ranges", () => {
    const chunks = splitFrames(4107, 6);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!.start).toBe(chunks[i - 1]!.end);
    }
    expect(chunks.at(-1)!.end).toBe(4107);
  });
});

describe("protocol helpers", () => {
  it("computes frame count from fps + duration", () => {
    expect(frameCount({ fps: 30, durationMs: 6000 })).toBe(180);
    expect(frameCount({ fps: 24, durationMs: 1000 })).toBe(24);
  });

  it("maps frame index to its timestamp", () => {
    expect(frameTimeMs(0, 30)).toBe(0);
    expect(frameTimeMs(30, 30)).toBe(1000);
    expect(frameTimeMs(15, 30)).toBe(500);
  });
});
