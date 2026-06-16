import { describe, it, expect } from "vitest";
import { audio } from "../src/audio.ts";

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
