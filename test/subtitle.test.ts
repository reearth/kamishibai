import { describe, it, expect } from "vitest";
import { parseSubtitles, cueAt, mergeCues, cuesToSrt } from "../src/subtitle.ts";

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

describe("mergeCues", () => {
  it("sorts by start and drops exact duplicates", () => {
    const merged = mergeCues([
      { start: 4000, end: 5000, text: "b" },
      { start: 1000, end: 2000, text: "a" },
      { start: 4000, end: 5000, text: "b" }, // dup (chunk-boundary report)
    ]);
    expect(merged).toEqual([
      { start: 1000, end: 2000, text: "a" },
      { start: 4000, end: 5000, text: "b" },
    ]);
  });

  it("keeps same-time cues with different text", () => {
    const merged = mergeCues([
      { start: 0, end: 1000, text: "x" },
      { start: 0, end: 1000, text: "y" },
    ]);
    expect(merged).toHaveLength(2);
  });
});

describe("cuesToSrt", () => {
  it("serializes cues to SRT with HH:MM:SS,mmm and 1-based indices", () => {
    const srt = cuesToSrt([
      { start: 1000, end: 4000, text: "Hello world" },
      { start: 4500, end: 6000, text: "Second line\nwraps here" },
    ]);
    expect(srt).toBe(
      "1\n00:00:01,000 --> 00:00:04,000\nHello world\n\n" +
        "2\n00:00:04,500 --> 00:00:06,000\nSecond line\nwraps here\n",
    );
  });

  it("round-trips through parseSubtitles", () => {
    const cues = [
      { start: 0, end: 1500, text: "a" },
      { start: 2000, end: 3600, text: "b" },
    ];
    expect(parseSubtitles(cuesToSrt(cues))).toEqual(cues);
  });

  it("formats hours correctly", () => {
    const srt = cuesToSrt([{ start: 3_661_001, end: 3_662_000, text: "late" }]);
    expect(srt).toContain("01:01:01,001 --> 01:01:02,000");
  });

  it("is empty for no cues", () => {
    expect(cuesToSrt([])).toBe("");
  });
});
