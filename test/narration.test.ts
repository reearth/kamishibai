import { describe, it, expect } from "vitest";
import {
  narrationTotal,
  narrationLayout,
  narrationSequence,
  narrationScene,
  applyLexicon,
  type NarrationClip,
} from "../src/tts/index.ts";
import { seriesDuration } from "../src/series.ts";

const clip = (durationMs: number, text = "x"): NarrationClip => ({ src: "", durationMs, text });

describe("narrationTotal", () => {
  it("sums clip durations (rounded)", () => {
    expect(narrationTotal([clip(1000.4), clip(2000.6)])).toBe(3001);
  });

  it("is zero for no clips", () => {
    expect(narrationTotal([])).toBe(0);
  });
});

describe("narrationLayout", () => {
  it("sizes one scene per clip, padded, keeping the clip", () => {
    const scenes = narrationLayout([clip(1000, "a"), clip(2000, "b")], { padMs: 500 });
    expect(scenes).toEqual([
      { durationMs: 1500, clip: clip(1000, "a") },
      { durationMs: 2500, clip: clip(2000, "b") },
    ]);
  });

  it("applies crossfade to every scene after the first", () => {
    const scenes = narrationLayout([clip(1000), clip(1000), clip(1000)], { crossfadeMs: 400 });
    expect(scenes.map((s) => s.crossfadeMs)).toEqual([undefined, 400, 400]);
  });

  it("applies exitFade uniformly", () => {
    const scenes = narrationLayout([clip(1000), clip(1000)], { exitFadeMs: 300 });
    expect(scenes.map((s) => s.exitFadeMs)).toEqual([300, 300]);
  });

  it("pairs with seriesDuration (crossfades shorten the total)", () => {
    const scenes = narrationLayout([clip(1000), clip(2000)], { padMs: 500, crossfadeMs: 400 });
    // (1000+500) + (2000+500) - 400
    expect(seriesDuration(scenes)).toBe(3600);
  });
});

describe("narrationSequence", () => {
  it("gives cumulative start offsets within a scene", () => {
    const steps = narrationSequence([clip(1000, "a"), clip(800, "b"), clip(1200, "c")], { gapMs: 200 });
    expect(steps.map((s) => s.atMs)).toEqual([0, 1200, 2200]);
    expect(steps.map((s) => s.clip.text)).toEqual(["a", "b", "c"]);
  });

  it("honours a non-zero start", () => {
    const steps = narrationSequence([clip(500), clip(500)], { startMs: 300 });
    expect(steps.map((s) => s.atMs)).toEqual([300, 800]);
  });

  it("takes a per-position gap array (gapMs[i] follows clip i)", () => {
    // big pause after clip 0 (before the topic-change clip 1), tight after that
    const steps = narrationSequence([clip(1000, "a"), clip(1000, "b"), clip(1000, "c")], {
      gapMs: [1500, 200],
    });
    expect(steps.map((s) => s.atMs)).toEqual([0, 2500, 3700]);
  });

  it("takes a gap function of (index, clip)", () => {
    const steps = narrationSequence([clip(1000), clip(1000), clip(1000)], {
      gapMs: (i) => (i === 0 ? 800 : 100),
    });
    expect(steps.map((s) => s.atMs)).toEqual([0, 1800, 2900]);
  });
});

describe("narrationScene", () => {
  it("sequences after the lead and sizes the scene to the last clip + tail", () => {
    const { steps, durationMs } = narrationScene([clip(1000, "a"), clip(2000, "b")], {
      leadMs: 300,
      gapMs: 200,
      tailMs: 500,
    });
    expect(steps.map((s) => s.atMs)).toEqual([300, 1500]);
    // 300 + 1000 + 200 + 2000 + 500 (no gap after the last clip)
    expect(durationMs).toBe(4000);
  });

  it("is just lead + tail with no clips", () => {
    expect(narrationScene([], { leadMs: 300, tailMs: 500 })).toEqual({ steps: [], durationMs: 800 });
  });
});

describe("applyLexicon", () => {
  it("substitutes readings, longest key first", () => {
    const lex = { 町字: "まちあざ", 町: "まち", "Pub/Sub": "パブサブ" };
    expect(applyLexicon("町字と町とPub/Sub", lex)).toBe("まちあざとまちとパブサブ");
  });

  it("lets an earlier key beat a longer one that starts later", () => {
    const lex = { 京都: "きょうと", 都庁舎: "とちょうしゃ" };
    expect(applyLexicon("東京都庁舎", lex)).toBe("東きょうと庁舎");
    // a key spanning the whole word pins its reading
    expect(applyLexicon("東京都庁舎", { ...lex, 東京都庁舎: "とうきょうとちょうしゃ" })).toBe(
      "とうきょうとちょうしゃ",
    );
  });

  it("treats keys literally (no regex)", () => {
    expect(applyLexicon("a.b axb", { "a.b": "X" })).toBe("X axb");
  });

  it("leaves text alone without a lexicon", () => {
    expect(applyLexicon("町字", undefined)).toBe("町字");
  });
});
