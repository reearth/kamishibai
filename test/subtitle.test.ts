import { describe, it, expect } from "vitest";
import { parseSubtitles, cueAt } from "../src/subtitle.ts";

const SRT = `1
00:00:01,000 --> 00:00:04,000
Hello world

2
00:00:04,500 --> 00:00:06,000
Second line
wraps here
`;

const VTT = `WEBVTT

NOTE this is a comment

intro
00:01.000 --> 00:02.500 align:center
こんにちは

00:03.000 --> 00:04.000
bye
`;

describe("parseSubtitles", () => {
  it("parses SRT with comma millis and multi-line text", () => {
    const cues = parseSubtitles(SRT);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({ start: 1000, end: 4000, text: "Hello world" });
    expect(cues[1]!.text).toBe("Second line\nwraps here");
  });

  it("parses VTT, skipping the header/NOTE and cue ids + settings", () => {
    const cues = parseSubtitles(VTT);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({ start: 1000, end: 2500, text: "こんにちは" });
    expect(cues[1]).toEqual({ start: 3000, end: 4000, text: "bye" });
  });
});

describe("cueAt", () => {
  it("finds the active cue (start ≤ ms < end), else undefined", () => {
    const cues = parseSubtitles(SRT);
    expect(cueAt(cues, 500)).toBeUndefined();
    expect(cueAt(cues, 1000)?.text).toBe("Hello world");
    expect(cueAt(cues, 4000)).toBeUndefined(); // end is exclusive
    expect(cueAt(cues, 5000)?.text).toContain("Second line");
  });
});
