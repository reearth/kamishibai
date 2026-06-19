import { describe, it, expect } from "vitest";
import {
  parseFrameRanges,
  manifestMatches,
  manifestFrames,
  buildManifest,
  MANIFEST_VERSION,
  type FrameManifest,
  type ManifestKey,
} from "../src/incremental.ts";

const KEY: ManifestKey = { fps: 30, width: 1920, height: 1080, scale: 1 };

describe("parseFrameRanges", () => {
  it("parses single indices and ranges", () => {
    expect([...parseFrameRanges("0,2,5-7", 100)]).toEqual([0, 2, 5, 6, 7]);
  });

  it("tolerates whitespace and dedupes overlaps", () => {
    expect([...parseFrameRanges(" 1-3 , 2-4 ", 100)]).toEqual([1, 2, 3, 4]);
  });

  it("normalizes reversed ranges", () => {
    expect([...parseFrameRanges("7-5", 100)]).toEqual([5, 6, 7]);
  });

  it("clamps to [0, total)", () => {
    expect([...parseFrameRanges("98-200", 100)]).toEqual([98, 99]);
  });

  it("returns empty for an empty spec", () => {
    expect(parseFrameRanges("", 100).size).toBe(0);
    expect(parseFrameRanges("  ,  ", 100).size).toBe(0);
  });

  it("throws on a malformed token", () => {
    expect(() => parseFrameRanges("0-", 100)).toThrow(/bad range/);
    expect(() => parseFrameRanges("abc", 100)).toThrow(/bad range/);
  });
});

describe("manifest validity", () => {
  const make = (over: Partial<FrameManifest> = {}): FrameManifest => ({
    ...buildManifest(KEY, new Map([[0, "aa"], [1, "bb"]])),
    ...over,
  });

  it("matches when geometry and version agree", () => {
    expect(manifestMatches(make(), KEY)).toBe(true);
  });

  it("rejects a different fps / size / scale", () => {
    expect(manifestMatches(make(), { ...KEY, fps: 24 })).toBe(false);
    expect(manifestMatches(make(), { ...KEY, width: 1280 })).toBe(false);
    expect(manifestMatches(make(), { ...KEY, scale: 2 })).toBe(false);
  });

  it("rejects an older manifest version", () => {
    expect(manifestMatches(make({ version: MANIFEST_VERSION - 1 }), KEY)).toBe(false);
  });

  it("rejects undefined", () => {
    expect(manifestMatches(undefined, KEY)).toBe(false);
  });
});

describe("manifestFrames", () => {
  it("round-trips a fingerprint map when valid", () => {
    const m = buildManifest(KEY, new Map([[0, "aa"], [5, "bb"]]));
    const map = manifestFrames(m, KEY);
    expect(map.get(0)).toBe("aa");
    expect(map.get(5)).toBe("bb");
  });

  it("yields an empty map when geometry mismatches", () => {
    const m = buildManifest(KEY, new Map([[0, "aa"]]));
    expect(manifestFrames(m, { ...KEY, scale: 2 }).size).toBe(0);
  });
});
