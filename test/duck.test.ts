import { describe, it, expect } from "vitest";
import { applyDucking, clipKey, createClipRegistry, duckKeyframes, type AudioClip } from "../src/audio.ts";

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

describe("applyDucking windows", () => {
  const bgm: AudioClip = { src: "bgm.mp3", atMs: 0, loop: true, duck: { attackMs: 0, releaseMs: 1 } };
  // [first, last] ms of the dipped keyframes, or undefined when nothing dips
  const dipSpan = (clips: AudioClip[], ctx?: Parameters<typeof applyDucking>[1]) => {
    const kf = applyDucking(clips, ctx).find((c) => c.duck)!.gainKeyframes ?? [];
    const dipped = kf.filter((k) => k.gain < 0).map((k) => k.atMs);
    return dipped.length ? [Math.min(...dipped), Math.max(...dipped)] : undefined;
  };

  it("uses a probed source length for a clip without durationMs", () => {
    const vo: AudioClip = { src: "vo.wav", atMs: 1000 };
    expect(dipSpan([bgm, vo])).toBeUndefined(); // unknown length: no dip
    expect(dipSpan([bgm, vo], { sourceMs: new Map([["vo.wav", 2000]]) })).toEqual([1000, 3000]);
  });

  it("subtracts trimStartMs and caps durationMs at what the source has left", () => {
    const vo: AudioClip = { src: "vo.wav", atMs: 0, trimStartMs: 500, durationMs: 5000 };
    expect(dipSpan([bgm, vo], { sourceMs: new Map([["vo.wav", 2000]]) })).toEqual([0, 1500]);
  });

  it("runs a non-ducked loop without durationMs to the reel end, and clamps to it", () => {
    const amb: AudioClip = { src: "amb.wav", atMs: 1000, loop: true };
    expect(dipSpan([bgm, amb])).toBeUndefined();
    expect(dipSpan([bgm, amb], { reelMs: 4000 })).toEqual([1000, 4000]);
    const long: AudioClip = { src: "vo.wav", atMs: 3000, durationMs: 5000 };
    expect(dipSpan([bgm, long], { reelMs: 4000 })).toEqual([3000, 4000]);
  });

  it("never dips a ducked clip under another ducked clip", () => {
    const bgm2: AudioClip = { ...bgm, src: "bgm2.mp3", durationMs: 3000 };
    expect(dipSpan([bgm, bgm2])).toBeUndefined();
  });
});

describe("clipKey", () => {
  const base: AudioClip = { src: "a.wav", atMs: 0 };

  it("distinguishes clips differing in any field", () => {
    const variants: AudioClip[] = [
      base,
      { ...base, gain: -3 },
      { ...base, trimStartMs: 100 },
      { ...base, durationMs: 1000 },
      { ...base, fadeInMs: 10 },
      { ...base, fadeOutMs: 10 },
      { ...base, loop: true },
      { ...base, duck: true },
      { ...base, duck: { amountDb: -6 } },
      { ...base, gainKeyframes: [{ atMs: 0, gain: -1 }] },
    ];
    expect(new Set(variants.map(clipKey)).size).toBe(variants.length);
  });

  it("treats omitted defaults as equal to explicit ones", () => {
    expect(clipKey({ ...base, gain: 0, trimStartMs: 0, loop: false })).toBe(clipKey(base));
  });
});

describe("createClipRegistry", () => {
  it("dedups identical clips but keeps clips that differ only in trim", () => {
    const r = createClipRegistry();
    r.register({ src: "a.wav", atMs: 0 });
    r.register({ src: "a.wav", atMs: 0 });
    r.register({ src: "a.wav", atMs: 0, trimStartMs: 500 });
    expect(r.clips).toHaveLength(2);
  });

  it("replaces a declaration's stale clip when its props change", () => {
    const r = createClipRegistry();
    let key = r.register({ src: "a.wav", atMs: 0 });
    key = r.register({ src: "a.wav", atMs: 0, durationMs: 1200 }, key);
    expect(r.clips).toEqual([{ src: "a.wav", atMs: 0, durationMs: 1200 }]);
    r.register({ src: "a.wav", atMs: 0, durationMs: 1200 }, key); // unchanged re-run
    expect(r.clips).toHaveLength(1);
  });

  it("reset empties the live array in place", () => {
    const r = createClipRegistry();
    const live = r.clips;
    r.register({ src: "a.wav", atMs: 0 });
    r.reset();
    expect(live).toHaveLength(0);
    expect(r.clips).toBe(live);
  });
});
