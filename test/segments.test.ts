import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planSegments, encodeSegmented, SEGMENTS_DIR, SEGMENT_SECONDS } from "../src/segments.ts";

const prints = (n: number, f = (i: number) => `p${i}`) => new Map(Array.from({ length: n }, (_, i) => [i, f(i)]));

describe("planSegments", () => {
  it("splits into SEGMENT_SECONDS segments, the last one short", () => {
    const segs = planSegments(150, 30, prints(150), {});
    const size = SEGMENT_SECONDS * 30;
    expect(segs.map((s) => [s.start, s.end])).toEqual([
      [0, size],
      [size, 2 * size],
      [2 * size, 150],
    ]);
  });

  it("gives the same keys for the same frames and settings", () => {
    expect(planSegments(150, 30, prints(150), { crf: 18 })).toEqual(planSegments(150, 30, prints(150), { crf: 18 }));
  });

  it("re-keys only the segment holding a changed frame", () => {
    const a = planSegments(150, 30, prints(150), {});
    const b = planSegments(150, 30, prints(150, (i) => (i === 70 ? "edited" : `p${i}`)), {});
    expect(a.map((s, k) => s.key === b[k]!.key)).toEqual([true, false, true]);
  });

  it("re-keys every segment when the settings change", () => {
    const a = planSegments(150, 30, prints(150), { crf: 18 });
    const b = planSegments(150, 30, prints(150), { crf: 23 });
    expect(a.every((s, k) => s.key !== b[k]!.key)).toBe(true);
  });

  it("leaves a segment unkeyed when one of its frames has no print", () => {
    const p = prints(150);
    p.delete(65);
    const segs = planSegments(150, 30, p, {});
    expect(segs.map((s) => s.key === undefined)).toEqual([false, true, false]);
    expect(segs[1]!.file).toMatch(/-unkeyed\.mp4$/);
  });
});

describe("encodeSegmented", () => {
  const frameCount = (file: string) =>
    Number(
      execFileSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", file], {
        encoding: "utf8",
      }).trim(),
    );

  it("encodes only the segments whose frames changed, and joins them all", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kb-seg-"));
    // 150 small frames, f000000.png … as the renderer writes them: three
    // segments at 30 fps.
    execFileSync("ffmpeg", [
      "-v", "error",
      "-f", "lavfi", "-i", "testsrc=size=64x48:rate=30:duration=5",
      "-start_number", "0", join(dir, "f%06d.png"),
    ]);
    expect((await readdir(dir)).filter((f) => f.endsWith(".png"))).toHaveLength(150);

    const base = { framesDir: dir, fps: 30, totalFrames: 150, geometry: "64x48@1" };
    const first = await encodeSegmented({ ...base, prints: prints(150), out: join(dir, "a.mp4") });
    expect(first).toEqual({ encoded: 3, total: 3 });
    expect(frameCount(join(dir, "a.mp4"))).toBe(150);

    const same = await encodeSegmented({ ...base, prints: prints(150), out: join(dir, "b.mp4") });
    expect(same.encoded).toBe(0);
    expect(frameCount(join(dir, "b.mp4"))).toBe(150);

    const edited = prints(150, (i) => (i === 100 ? "edited" : `p${i}`));
    const one = await encodeSegmented({ ...base, prints: edited, out: join(dir, "c.mp4") });
    expect(one.encoded).toBe(1);
    expect(frameCount(join(dir, "c.mp4"))).toBe(150);
    // The edited segment's old version is gone.
    expect(await readdir(join(dir, SEGMENTS_DIR))).toHaveLength(3);
  }, 60_000);
});
