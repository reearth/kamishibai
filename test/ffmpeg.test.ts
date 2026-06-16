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
    // before t=1: hold 0dB; after t=2: hold -20dB
    expect(e).toContain("if(lt(t,1.000000),0,");
    expect(e).toContain("if(lt(t,2.000000),");
    expect(e.startsWith("pow(10,(")).toBe(true);
  });

  it("adds the base gain to every keyframe", () => {
    expect(volumeExpr([{ atMs: 0, gain: -3 }], -6)).toBe("pow(10,(-9)/20)");
  });
});
