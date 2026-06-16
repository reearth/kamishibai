import { describe, it, expect } from "vitest";
import { bezier, eases, ramp } from "../src/easing.ts";

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
