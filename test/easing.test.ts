import { describe, it, expect } from "vitest";
import { bezier, eases, ramp, spring, track, stagger, interpolateColor } from "../src/easing.ts";

describe("bezier", () => {
  it("pins the endpoints to 0 and 1", () => {
    const e = bezier(0.16, 1, 0.3, 1);
    expect(e(0)).toBe(0);
    expect(e(1)).toBe(1);
  });

  it("linear control points behave linearly", () => {
    const lin = bezier(0, 0, 1, 1);
    expect(lin(0.5)).toBeCloseTo(0.5, 2);
    expect(lin(0.25)).toBeCloseTo(0.25, 2);
  });

  it("an ease-out curve is ahead of linear in the first half", () => {
    expect(eases.smooth(0.25)).toBeGreaterThan(0.25);
  });
});

describe("ramp", () => {
  it("clamps before/after the window", () => {
    expect(ramp(-100, 0, 1000, 0, 10)).toBe(0);
    expect(ramp(5000, 0, 1000, 0, 10)).toBe(10);
  });

  it("interpolates linearly by default", () => {
    expect(ramp(500, 0, 1000, 0, 10)).toBeCloseTo(5);
  });

  it("returns the end value for a zero-width window", () => {
    expect(ramp(0, 1000, 1000, 2, 9)).toBe(2);
    expect(ramp(2000, 1000, 1000, 2, 9)).toBe(9);
  });

  it("applies an easing curve", () => {
    // at the midpoint, ease-out is past halfway
    expect(ramp(500, 0, 1000, 0, 100, eases.smooth)).toBeGreaterThan(50);
  });
});

describe("spring", () => {
  it("starts at 0 and settles near 1", () => {
    const s = spring();
    expect(s(0)).toBe(0);
    expect(s(3)).toBeCloseTo(1, 1);
  });

  it("overshoots past 1 when under-damped", () => {
    const bouncy = spring({ stiffness: 180, damping: 8 });
    const peak = Math.max(...Array.from({ length: 50 }, (_, i) => bouncy(i / 50)));
    expect(peak).toBeGreaterThan(1);
  });

  it("does not overshoot when critically/over-damped", () => {
    const stiff = spring({ stiffness: 100, damping: 30 });
    const peak = Math.max(...Array.from({ length: 100 }, (_, i) => stiff(i / 25)));
    expect(peak).toBeLessThanOrEqual(1.001);
  });
});

describe("track", () => {
  it("holds flat outside the range and interpolates within", () => {
    const stops = [
      { at: 0, value: 0 },
      { at: 1000, value: 100 },
      { at: 2000, value: 50 },
    ];
    expect(track(-100, stops)).toBe(0);
    expect(track(3000, stops)).toBe(50);
    expect(track(500, stops)).toBeCloseTo(50);
    expect(track(1500, stops)).toBeCloseTo(75);
  });
});

describe("stagger", () => {
  it("delays from the start by default", () => {
    expect(stagger(0, { each: 100 })).toBe(0);
    expect(stagger(3, { each: 100 })).toBe(300);
  });
  it("supports end and center anchors", () => {
    expect(stagger(0, { each: 100, from: "end", total: 4 })).toBe(300);
    expect(stagger(0, { each: 100, from: "center", total: 5 })).toBe(200);
    expect(stagger(2, { each: 100, from: "center", total: 5 })).toBe(0);
  });
});

describe("interpolateColor", () => {
  it("interpolates between hex colors in sRGB", () => {
    expect(interpolateColor("#000000", "#ffffff", 0)).toBe("rgb(0, 0, 0)");
    expect(interpolateColor("#000000", "#ffffff", 1)).toBe("rgb(255, 255, 255)");
    expect(interpolateColor("#000", "#fff", 0.5)).toBe("rgb(128, 128, 128)");
  });
});
