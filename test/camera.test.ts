import { describe, it, expect } from "vitest";
import { cameraAt, cameraTransform } from "../src/camera.ts";
import { eases } from "../src/easing.ts";

describe("cameraAt", () => {
  const shots = [
    { at: 0, x: 0, y: 0, zoom: 1 },
    { at: 1000, x: 100, y: 50, zoom: 4, ease: eases.linear },
  ];

  it("holds the first shot before it and the last after it", () => {
    expect(cameraAt(-10, shots)).toEqual({ x: 0, y: 0, zoom: 1, rotate: 0 });
    expect(cameraAt(5000, shots)).toEqual({ x: 100, y: 50, zoom: 4, rotate: 0 });
  });

  it("eases position and interpolates zoom geometrically", () => {
    const c = cameraAt(500, shots);
    expect(c.x).toBeCloseTo(50);
    expect(c.y).toBeCloseTo(25);
    // halfway between 1x and 4x in log space is 2x, not 2.5x
    expect(c.zoom).toBeCloseTo(2);
  });

  it("is a neutral camera with no shots", () => {
    expect(cameraAt(0, [])).toEqual({ x: 0, y: 0, zoom: 1, rotate: 0 });
  });
});

describe("cameraTransform", () => {
  it("scales, then moves the world point to the origin", () => {
    expect(cameraTransform({ x: 10, y: 20, zoom: 2 })).toBe("scale(2) rotate(0deg) translate(-10px, -20px)");
  });
});
