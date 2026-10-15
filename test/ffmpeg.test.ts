import { execFileSync } from "node:child_process";
import { describe, it, expect } from "vitest";
import { audio } from "../src/audio.ts";
import { buildAudioGraph, volumeExpr } from "../src/ffmpeg.ts";

describe("audio manifest helper", () => {
  it("passes clips through unchanged", () => {
    const clips = audio([
      { src: "vo/intro.m4a", atMs: 0 },
      { src: "bgm.mp3", atMs: 0, gain: -18 },
    ]);
    expect(clips).toHaveLength(2);
    expect(clips[1]!.gain).toBe(-18);
  });
});

describe("buildAudioGraph", () => {
  it("delays a single clip and wraps it as [aout]", () => {
    const g = buildAudioGraph([{ src: "a.m4a", atMs: 500 }]);
    expect(g.inputs).toEqual(["-i", "a.m4a"]);
    expect(g.filterComplex).toBe("[1:a]adelay=500:all=1[a0];[a0]anull[aout]");
  });

  it("applies trim, fades and gain in order", () => {
    const g = buildAudioGraph([
      { src: "a.m4a", atMs: 1000, trimStartMs: 250, durationMs: 2000, fadeInMs: 100, fadeOutMs: 400, gain: -6 },
    ]);
    const f = g.filterComplex;
    expect(f).toContain("atrim=start=0.250000:duration=2.000000");
    expect(f).toContain("asetpts=PTS-STARTPTS");
    expect(f).toContain("afade=t=in:st=0:d=0.100000");
    // fade-out starts at duration - fadeOut = 1.6s
    expect(f).toContain("afade=t=out:st=1.600000:d=0.400000");
    expect(f).toContain("volume=-6dB");
    expect(f).toContain("adelay=1000:all=1");
  });

  it("skips fade-out without a known duration", () => {
    const g = buildAudioGraph([{ src: "a.m4a", atMs: 0, fadeOutMs: 300 }]);
    expect(g.filterComplex).not.toContain("afade=t=out");
  });

  it("mixes multiple clips with normalize=0", () => {
    const g = buildAudioGraph([
      { src: "a.m4a", atMs: 0 },
      { src: "b.m4a", atMs: 100 },
    ]);
    expect(g.inputs).toEqual(["-i", "a.m4a", "-i", "b.m4a"]);
    expect(g.filterComplex).toContain("amix=inputs=2:normalize=0");
  });

  it("loops a clip via -stream_loop and bounds it to the reel end", () => {
    const g = buildAudioGraph([{ src: "bgm.mp3", atMs: 0, loop: true }], 20000);
    expect(g.inputs).toEqual(["-stream_loop", "-1", "-i", "bgm.mp3"]);
    // tiled and trimmed to the span from atMs (0) to the reel end (20s)
    expect(g.filterComplex).toContain("atrim=duration=20.000000");
  });

  it("places fadeOut at the reel end for a looped clip (no explicit duration)", () => {
    const g = buildAudioGraph([{ src: "bgm.mp3", atMs: 2000, fadeOutMs: 800, loop: true }], 10000);
    // span = 10000 - 2000 = 8000ms; fade-out starts at span - 800 = 7200ms
    expect(g.filterComplex).toContain("afade=t=out:st=7.200000:d=0.800000");
  });

  it("loops without a known reel length (unbounded, clamped later by -t)", () => {
    const g = buildAudioGraph([{ src: "bgm.mp3", atMs: 0, loop: true }]);
    expect(g.inputs.slice(0, 2)).toEqual(["-stream_loop", "-1"]);
    expect(g.filterComplex).not.toContain("atrim");
  });

  it("does not loop a normal clip", () => {
    const g = buildAudioGraph([{ src: "a.m4a", atMs: 0 }], 20000);
    expect(g.inputs).toEqual(["-i", "a.m4a"]);
  });

  it("emits a volume automation expression for gainKeyframes", () => {
    const g = buildAudioGraph([
      { src: "bgm.mp3", atMs: 0, gainKeyframes: [
        { atMs: 0, gain: 0 },
        { atMs: 1000, gain: -18 },
        { atMs: 2000, gain: 0 },
      ] },
    ]);
    expect(g.filterComplex).toContain("volume=volume='");
    expect(g.filterComplex).toContain("eval=frame");
    // not a static volume=NdB step
    expect(g.filterComplex).not.toContain("volume=0dB");
  });
});

describe("volumeExpr", () => {
  it("is constant for a single keyframe", () => {
    expect(volumeExpr([{ atMs: 0, gain: -6 }])).toBe("pow(10,(-6)/20)");
  });

  it("holds flat before the first and after the last keyframe", () => {
    const e = volumeExpr([
      { atMs: 1000, gain: 0 },
      { atMs: 2000, gain: -20 },
    ]);
    // 0dB until t=1, a linear ramp to -20dB at t=2, then -20dB
    const at = sampleExpr(e, 3);
    expect(at(0.5)).toBeCloseTo(1, 4);
    expect(at(1.5)).toBeCloseTo(10 ** (-10 / 20), 4);
    expect(at(2.5)).toBeCloseTo(10 ** (-20 / 20), 4);
  });

  it("steps at coincident keyframes", () => {
    const e = volumeExpr([
      { atMs: 0, gain: 0 },
      { atMs: 1000, gain: 0 },
      { atMs: 1000, gain: -20 },
      { atMs: 2000, gain: -20 },
    ]);
    const at = sampleExpr(e, 2);
    expect(at(0.9)).toBeCloseTo(1, 4);
    expect(at(1.1)).toBeCloseTo(0.1, 4);
  });

  it("stays parseable by ffmpeg with hundreds of keyframes", () => {
    // ffmpeg rejects expressions nested ~100 deep; a long ducked reel has more keyframes.
    const kf = Array.from({ length: 300 }, (_, i) => ({ atMs: i * 100, gain: i % 2 === 0 ? 0 : -20 }));
    const at = sampleExpr(volumeExpr(kf), 30);
    expect(at(0.05)).toBeCloseTo(10 ** (-10 / 20), 4); // halfway down the first ramp
    expect(at(29.95)).toBeCloseTo(0.1, 4); // after the last keyframe (-20dB)
  });

  it("adds the base gain to every keyframe", () => {
    expect(volumeExpr([{ atMs: 0, gain: -3 }], -6)).toBe("pow(10,(-9)/20)");
  });
});

/** Evaluate a volume expression with ffmpeg itself, sampled at 1kHz over `durSec`. */
function sampleExpr(expr: string, durSec: number): (sec: number) => number {
  const raw = execFileSync(
    "ffmpeg",
    ["-v", "error", "-f", "lavfi", "-i", `aevalsrc=exprs='${expr}':s=1000:d=${durSec}`, "-f", "f64le", "-"],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  const samples = new Float64Array(raw.buffer, raw.byteOffset, raw.byteLength / 8);
  return (sec) => samples[Math.round(sec * 1000)]!;
}
