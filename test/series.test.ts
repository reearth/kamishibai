import { describe, it, expect } from "vitest";
import {
  seriesLayout,
  seriesDuration,
  exitFadeOpacity,
  type SceneSpec,
  type SceneLayout,
} from "../src/series.ts";

describe("seriesDuration", () => {
  it("is zero for no scenes", () => {
    expect(seriesDuration([])).toBe(0);
  });

  it("sums durations back-to-back without crossfades", () => {
    expect(seriesDuration([{ durationMs: 1000 }, { durationMs: 2000 }])).toBe(3000);
  });

  it("subtracts crossfades (the overlap shortens the timeline)", () => {
    const scenes: SceneSpec[] = [
      { durationMs: 1000 },
      { durationMs: 2000, crossfadeMs: 400 },
      { durationMs: 1500, crossfadeMs: 300 },
    ];
    // 1000 + 2000 + 1500 - 400 - 300
    expect(seriesDuration(scenes)).toBe(3800);
  });

  it("ignores a crossfade on the first scene (nothing to overlap)", () => {
    expect(seriesDuration([{ durationMs: 1000, crossfadeMs: 500 }])).toBe(1000);
  });
});

describe("seriesLayout", () => {
  it("places a single scene at zero with no crossfades", () => {
    expect(seriesLayout([{ durationMs: 1000 }])).toEqual([
      { start: 0, durationMs: 1000, xfIn: 0, xfOut: 0, exitFadeMs: 0 },
    ]);
  });

  it("pulls each crossfading scene earlier so it overlaps the previous", () => {
    const scenes: SceneSpec[] = [
      { durationMs: 1000 },
      { durationMs: 2000, crossfadeMs: 400 },
    ];
    expect(seriesLayout(scenes)).toEqual([
      { start: 0, durationMs: 1000, xfIn: 0, xfOut: 400, exitFadeMs: 0 },
      { start: 600, durationMs: 2000, xfIn: 400, xfOut: 0, exitFadeMs: 0 },
    ]);
  });

  it("exposes each scene's xfOut as the next scene's crossfade", () => {
    const placed = seriesLayout([
      { durationMs: 1000 },
      { durationMs: 1000, crossfadeMs: 200 },
      { durationMs: 1000, crossfadeMs: 300 },
    ]);
    expect(placed.map((p) => p.xfOut)).toEqual([200, 300, 0]);
    expect(placed.map((p) => p.xfIn)).toEqual([0, 200, 300]);
    expect(placed.map((p) => p.start)).toEqual([0, 800, 1500]);
  });

  it("carries exitFadeMs through untouched", () => {
    const [a] = seriesLayout([{ durationMs: 1000, exitFadeMs: 250 }]);
    expect(a!.exitFadeMs).toBe(250);
  });

  it("agrees with seriesDuration on total length", () => {
    const scenes: SceneSpec[] = [
      { durationMs: 1200 },
      { durationMs: 1800, crossfadeMs: 500 },
      { durationMs: 900, crossfadeMs: 200 },
    ];
    const placed = seriesLayout(scenes);
    const last = placed[placed.length - 1]!;
    expect(last.start + last.durationMs).toBe(seriesDuration(scenes));
  });
});

describe("exitFadeOpacity", () => {
  const place = (o: Partial<SceneLayout> = {}): SceneLayout => ({
    start: 0,
    durationMs: 3000,
    xfIn: 0,
    xfOut: 0,
    exitFadeMs: 0,
    ...o,
  });

  it("is 1 throughout when there is no exit-fade", () => {
    expect(exitFadeOpacity(place(), 2999)).toBe(1);
  });

  it("fades over the last exitFadeMs when there is no crossfade out", () => {
    const p = place({ exitFadeMs: 600 });
    expect(exitFadeOpacity(p, 2400)).toBe(1);
    expect(exitFadeOpacity(p, 2700)).toBeCloseTo(0.5);
    expect(exitFadeOpacity(p, 3000)).toBe(0);
  });

  it("finishes before the next scene's crossfade begins (no ghosting)", () => {
    // crossfade 700 + exit 600: content fades 1700..2300, gone for the overlap.
    const p = place({ exitFadeMs: 600, xfOut: 700 });
    expect(exitFadeOpacity(p, 1700)).toBe(1);
    expect(exitFadeOpacity(p, 2000)).toBeCloseTo(0.5);
    expect(exitFadeOpacity(p, 2300)).toBe(0);
    expect(exitFadeOpacity(p, 2999)).toBe(0);
  });
});
