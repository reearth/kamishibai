import { describe, it, expect } from "vitest";
import { parseSubtitles, cueAt, mergeCues, cuesToSrt, isPlayableCue } from "../src/subtitle.ts";

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

describe("unplayable cues (end <= start)", () => {
  const silence = () => {
    const warn = console.warn;
    const msgs: string[] = [];
    console.warn = (m: string) => void msgs.push(m);
    return { msgs, restore: () => void (console.warn = warn) };
  };

  it("are dropped by parseSubtitles with a warning", () => {
    const s = silence();
    try {
      const cues = parseSubtitles(
        `1\n00:00:00,900 --> 00:00:00,800\ninverted\n\n2\n00:00:01,000 --> 00:00:01,000\nzero\n\n3\n00:00:02,000 --> 00:00:03,000\nok\n`,
      );
      expect(cues).toEqual([{ start: 2000, end: 3000, text: "ok" }]);
      expect(s.msgs).toHaveLength(2);
    } finally {
      s.restore();
    }
  });

  it("are dropped by mergeCues / cuesToSrt, so the srt never carries one", () => {
    const s = silence();
    try {
      const cues = [
        { start: 900, end: 800, text: "inverted" },
        { start: 0, end: 500, text: "ok" },
      ];
      expect(mergeCues(cues)).toEqual([{ start: 0, end: 500, text: "ok" }]);
      expect(cuesToSrt(cues)).not.toContain("inverted");
    } finally {
      s.restore();
    }
  });

  it("is what isPlayableCue reports", () => {
    expect(isPlayableCue({ start: 0, end: 1, text: "a" })).toBe(true);
    expect(isPlayableCue({ start: 1, end: 1, text: "a" })).toBe(false);
    expect(isPlayableCue({ start: 2, end: 1, text: "a" })).toBe(false);
    expect(isPlayableCue({ start: NaN, end: 1, text: "a" })).toBe(false);
  });
});
