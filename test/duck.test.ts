import { describe, it, expect } from "vitest";
import { applyDucking, duckKeyframes, type AudioClip } from "../src/audio.ts";

describe("duckKeyframes", () => {
  it("dips to amountDb across a window with attack/release ramps", () => {
    const kf = duckKeyframes([[2000, 4000]], 0, { amountDb: -12, attackMs: 250, releaseMs: 600 });
    expect(kf).toEqual([
      { atMs: 0, gain: 0 },
      { atMs: 1750, gain: 0 }, // attack starts (2000 - 250)
      { atMs: 2000, gain: -12 }, // fully ducked as the clip starts
      { atMs: 4000, gain: -12 }, // held to the end
      { atMs: 4600, gain: 0 }, // released (4000 + 600)
    ]);
  });

  it("is relative to the ducked clip's own start", () => {
    const kf = duckKeyframes([[3000, 4000]], 1000, { amountDb: -10, attackMs: 0, releaseMs: 0 });
    // offsets shift by -1000 (clip starts at 1000)
    expect(kf).toContainEqual({ atMs: 2000, gain: -10 });
    expect(kf).toContainEqual({ atMs: 3000, gain: 0 });
  });

  it("bridges short gaps so the dip holds through pauses", () => {
    // two windows 300ms apart; attack+release (250+600) > 300 → bridged into one
    const kf = duckKeyframes([[1000, 2000], [2300, 3000]], 0, {
      amountDb: -12,
      attackMs: 250,
      releaseMs: 600,
    });
    // a single release at the end of the merged window, not between them
    const releases = kf.filter((k) => k.gain === 0 && k.atMs > 1000);
    expect(releases).toEqual([{ atMs: 3600, gain: 0 }]);
  });

  it("returns nothing when there are no windows", () => {
    expect(duckKeyframes([], 0)).toEqual([]);
  });
});

describe("applyDucking", () => {
  const narration = (atMs: number, durationMs: number): AudioClip => ({ src: "vo.m4a", atMs, durationMs });

  it("derives gainKeyframes for a ducked clip from non-ducked windows", () => {
    const clips: AudioClip[] = [
      narration(0, 2000),
      { src: "bgm.mp3", atMs: 0, loop: true, gain: -18, duck: true },
    ];
    const out = applyDucking(clips);
    expect(out[0]!.gainKeyframes).toBeUndefined(); // narration untouched
    expect(out[1]!.gainKeyframes!.some((k) => k.gain === -12)).toBe(true); // bgm ducked
  });

  it("leaves clips alone when none are ducked", () => {
    const clips: AudioClip[] = [narration(0, 2000)];
    expect(applyDucking(clips)).toBe(clips);
  });

  it("does not override an explicit gainKeyframes", () => {
    const manual = [{ atMs: 0, gain: -6 }];
    const clips: AudioClip[] = [
      narration(0, 2000),
      { src: "bgm.mp3", atMs: 0, duck: true, gainKeyframes: manual },
    ];
    expect(applyDucking(clips)[1]!.gainKeyframes).toBe(manual);
  });

  it("honours a custom dip amount", () => {
    const clips: AudioClip[] = [
      narration(1000, 1000),
      { src: "bgm.mp3", atMs: 0, duck: { amountDb: -24 } },
    ];
    expect(applyDucking(clips)[1]!.gainKeyframes!.some((k) => k.gain === -24)).toBe(true);
  });
});
